import { useEffect, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { SELECTION_POPUP_PANEL_MESSAGE, type SelectionPopupPanelRequest } from '@/shared/protocol';
import type { PopupRecord } from '@/shared/snippet';
import { useJob, usePrivacy, useSnippet } from '../sidepanel/hooks.ts';
import type { JobActions } from '../sidepanel/JobBar.tsx';
import { SelectionView } from '../sidepanel/SelectionView.tsx';
import type { Translator } from '../sidepanel/translator.ts';
import { waitForPopupRecord } from './record.ts';

type Browser = typeof browser;

// The selection popup (DESIGN.md §3): the selection button's click shows the translation here, next
// to the text, instead of in the side panel. It is the panel's selection mode in a small extension
// page: the same jobs, route and actions (translator.ts), so it translates exactly as the panel
// would. Open in side panel hands the selection over to the panel.
//
// A page can't read the popup, but it can restyle its host or lay decoys over it, so the popup offers
// nothing that outlasts this one selection: the first-run privacy notice and the spend limit's
// Continue anyway are the panel's, which no page can cover.

export function Popup({ api, translator, id, onClose }: { api: Browser; translator: Pick<Translator, 'snippets' | 'privacy' | 'watch'>; id: string; onClose: () => void }) {
  // undefined: still waiting for the worker's record; null: none came.
  const [record, setRecord] = useState<PopupRecord | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void waitForPopupRecord(api, id).then((r) => live && setRecord(r ?? null));
    return () => {
      live = false;
    };
  }, [api, id]);
  const tabId = record?.tabId;
  useEffect(() => {
    if (!record) return;
    const stop = translator.watch(() => record.tabId, { selections: false });
    // Jobs run only for the tab on screen; the popup's tab is the one it is in.
    translator.snippets.jobs.setActive(record.tabId);
    void translator.snippets.take(record.tabId, record);
    return stop;
  }, [translator, record]);
  const snippet = useSnippet(translator.snippets.store, tabId);
  const job = useJob(translator.snippets.jobs, tabId, snippet?.docId);
  const privacy = usePrivacy(translator.privacy);
  const [panelFailed, setPanelFailed] = useState(false);

  // The panel opens first, in the click (sidePanel.open needs the gesture); once it is open, the
  // worker injects and hands the selection over, and the popup closes. A panel that did not open gets
  // no selection, so a later panel never translates it unasked.
  const openPanel = () => {
    if (!record) return;
    api.sidePanel.open({ tabId: record.tabId }).then(
      () =>
        api.runtime
          .sendMessage({ type: SELECTION_POPUP_PANEL_MESSAGE, id } satisfies SelectionPopupPanelRequest)
          .catch(() => undefined)
          .then(onClose),
      () => setPanelFailed(true),
    );
  };

  return (
    <main class="panel popup" data-testid="selection-popup">
      {privacy === 'needed' ? (
        <p class="state__hint" role="alert" data-testid="popup-privacy">
          {i18n.t('popup.privacy')}
        </p>
      ) : null}
      {record === null ? (
        <section class="selection">
          <div class="selection__head">
            <h2 class="selection__title">{i18n.t('popup.title')}</h2>
            <button type="button" class="ui-button" onClick={onClose}>
              {i18n.t('popup.close')}
            </button>
          </div>
          <p class="state__hint" role="alert" data-testid="popup-missing">
            {i18n.t('popup.missing')}
          </p>
        </section>
      ) : snippet && tabId !== undefined ? (
        <SelectionView snippet={snippet} job={job} actions={popupActions(translator.snippets.actions(tabId))} onClose={onClose} pageReady={false} />
      ) : (
        <p class="panel__meta">{i18n.t('panel.selection.translating')}</p>
      )}
      {panelFailed ? (
        <p class="state__hint" role="alert" data-testid="popup-panel-failed">
          {i18n.t('popup.panelFailed')}
        </p>
      ) : null}
      {record && !snippet?.blocked ? (
        <div class="popup__foot">
          <button type="button" class="ui-button" data-testid="popup-open-panel" onClick={openPanel}>
            {i18n.t('popup.openPanel')}
          </button>
        </div>
      ) : null}
    </main>
  );
}

/** The selection's actions without Continue anyway (see above): the limit bar then offers only Settings. */
function popupActions(actions: JobActions): JobActions {
  const { continuePastLimit, ...rest } = actions;
  void continuePastLimit;
  return rest;
}
