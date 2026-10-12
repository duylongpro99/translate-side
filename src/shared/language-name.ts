// How a language is named on screen. The prompt's wording is the engine's English `languageLabel` and stays so;
// this is only for what the reader sees: in a non-English interface the name comes from the browser's own
// language names (Intl.DisplayNames) in the interface language. Codes and the models' input are untouched.
import { browser } from 'wxt/browser';
import { languageLabel } from '@/engine/index';
import { LANGUAGES } from './settings.ts';

/** The interface languages with messages of their own (src/locales); any other Chrome language shows the English interface. */
const LOCALIZED = new Set(['vi']);

/** The interface language Chrome resolved for the extension (`en` when it cannot be read). */
function uiLocale(): string {
  try {
    return browser.i18n.getUILanguage() || 'en';
  } catch {
    return 'en';
  }
}

/** `code` as the reader should see it: the interface language's name when the extension ships that language, else the English name. */
export function languageName(code: string, locale: string = uiLocale()): string {
  const english = LANGUAGES.find((l) => l.code === code)?.name ?? languageLabel(code);
  const trimmed = code.trim();
  if (trimmed === '' || !LOCALIZED.has(locale.toLowerCase().split(/[-_]/)[0] ?? '')) return english;
  try {
    const name = new Intl.DisplayNames([locale.replace('_', '-')], { type: 'language' }).of(trimmed);
    // `of` echoes the code for one it does not know: keep the English wording then.
    return name && name !== trimmed ? name : english;
  } catch {
    return english;
  }
}
