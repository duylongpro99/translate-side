/* global chrome, Translator */
// S8 service worker. Opens the side panel on the toolbar icon, and answers the panel's
// "ask background to create Translator" button: availability, then Translator.create with no user
// activation in the worker. For information only (Q1): the product does not use this path, because
// it is undocumented, conflicts with decision S1, and gets around Chrome's download consent.
'use strict';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.error('[s8] setPanelBehavior', e));

/** Progress lines for the panel's log; the panel may be closed, so a failed send is ignored. */
function send(kind, data) {
  chrome.runtime.sendMessage({ type: 's8-bg-log', entry: { kind, data } }).catch(() => {});
}

const errInfo = (e) => ({ name: e?.name ?? typeof e, message: e?.message ?? String(e) });

async function createInWorker(sourceLanguage, targetLanguage) {
  const out = {
    apis: { Translator: typeof self.Translator, LanguageModel: typeof self.LanguageModel, LanguageDetector: typeof self.LanguageDetector },
    userActivation: typeof navigator.userActivation,
  };
  if (typeof self.Translator === 'undefined') return { ...out, error: { name: 'NoAPI', message: 'Translator is not defined in the service worker' } };
  const pair = { sourceLanguage, targetLanguage };
  try {
    out.before = await Translator.availability(pair);
  } catch (e) {
    return { ...out, error: errInfo(e), step: 'availability' };
  }
  const t0 = Date.now();
  try {
    const translator = await Translator.create({
      ...pair,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => send('downloadprogress', { label: `worker ${sourceLanguage}→${targetLanguage}`, loaded: e.loaded, total: e.total }));
      },
    });
    out.createdMs = Date.now() - t0;
    out.sample = await translator.translate('Hello, world.');
    translator.destroy();
    out.after = await Translator.availability(pair);
    return out;
  } catch (e) {
    return { ...out, error: errInfo(e), step: 'create', tookMs: Date.now() - t0 };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 's8-create-translator') return false;
  const source = typeof msg.sourceLanguage === 'string' ? msg.sourceLanguage : '';
  const target = typeof msg.targetLanguage === 'string' ? msg.targetLanguage : '';
  if (!source || !target) {
    sendResponse({ error: { name: 'BadRequest', message: 'sourceLanguage and targetLanguage are required' } });
    return false;
  }
  createInWorker(source, target).then(sendResponse, (e) => sendResponse({ error: errInfo(e) }));
  return true;
});
