// The page's first script: records which built-in AI globals the page sees before anything else
// runs. The e2e injection probe (spikes/s8/probe-q7.mjs) reads `__s8AtLoad` to tell whether a fake
// installed by Playwright's `addInitScript` was in place before the page's own code.
globalThis.__s8AtLoad = {
  at: Date.now(),
  Translator: typeof globalThis.Translator,
  LanguageModel: typeof globalThis.LanguageModel,
  LanguageDetector: typeof globalThis.LanguageDetector,
  translatorFake: globalThis.Translator?.__s8Fake === true,
  languageModelFake: globalThis.LanguageModel?.__s8Fake === true,
};
