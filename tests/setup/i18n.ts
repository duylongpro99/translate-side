// The shell tests run in English: the generated `en` messages answer `browser.i18n.getMessage`, which the
// fake browser does not implement. Substitutions follow Chrome's: `$1`–`$9` take the arguments, `$$` is a `$`.
import { generateChromeMessages, parseMessagesFile } from '@wxt-dev/i18n/build';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { resolve } from 'node:path';
import { beforeEach } from 'vitest';

const messages = generateChromeMessages(await parseMessagesFile(resolve(process.cwd(), 'src/locales/en.yml')));

export function getMessage(key: string, substitutions?: string | string[]): string {
  const text = messages[key]?.message;
  if (text === undefined) return '';
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  return text.replace(/\$(\$|[1-9])/g, (_, token: string) => (token === '$' ? '$' : (subs[Number(token) - 1] ?? '')));
}

const install = () => {
  (fakeBrowser as { i18n?: unknown }).i18n = { getMessage, getUILanguage: () => 'en' };
};
install();
beforeEach(install);
