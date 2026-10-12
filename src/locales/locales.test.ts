// The English and Vietnamese UI strings both load, and the Vietnamese keeps every key and placeholder of the English.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateChromeMessages, parseMessagesFile } from '@wxt-dev/i18n/build';
import { describe, expect, it } from 'vitest';

const dir = resolve(process.cwd(), 'src/locales');
type Message = Awaited<ReturnType<typeof parseMessagesFile>>[number];
const load = async (locale: string) => (await parseMessagesFile(resolve(dir, `${locale}.yml`))).filter((m) => !m.key[0]?.startsWith('@@'));
const byKey = (messages: Message[]) => new Map(messages.map((m) => [m.key.join('.'), m]));

describe('locales', () => {
  it('ships exactly en and vi', () => {
    expect(readdirSync(dir).filter((f) => f.endsWith('.yml')).sort()).toEqual(['en.yml', 'vi.yml']);
  });

  it('loads the English and Vietnamese messages', async () => {
    for (const locale of ['en', 'vi']) {
      const messages = generateChromeMessages(await load(locale));
      expect(messages.extName?.message).toBeTruthy();
      expect(messages.extDescription?.message).toBeTruthy();
    }
  });

  it('has the same keys in en and vi, with the same kind and placeholders', async () => {
    const en = byKey(await load('en'));
    const vi = byKey(await load('vi'));
    expect([...vi.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, message] of en) {
      const other = vi.get(key);
      expect(other?.type, `${key}: kind`).toBe(message.type);
      expect(other?.substitutions, `${key}: $N placeholders`).toBe(message.substitutions);
      expect([...(other?.namedSubstitutions ?? [])].sort(), `${key}: {name} placeholders`).toEqual([...message.namedSubstitutions].sort());
    }
  });

  it('has no empty message', async () => {
    for (const locale of ['en', 'vi']) {
      const empty = Object.entries(generateChromeMessages(await load(locale))).filter(([, v]) => v.message.trim() === '');
      expect(
        empty.map(([k]) => k),
        locale,
      ).toEqual([]);
    }
  });
});
