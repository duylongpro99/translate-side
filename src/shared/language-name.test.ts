import { describe, expect, it } from 'vitest';
import { languageLabel } from '@/engine/index';
import { renderSystemPromptV2 } from '@/engine/context/assemble';
import { languageName } from './language-name.ts';

describe('languageName: what the reader sees', () => {
  it('is the English name in an English interface, as before', () => {
    expect(languageName('vi', 'en')).toBe('Vietnamese');
    expect(languageName('vi', 'en-US')).toBe('Vietnamese');
    expect(languageName('zh-CN', 'en')).toBe('Chinese (Simplified)');
    expect(languageName('pt-BR', 'en')).toBe('Portuguese (Brazil)');
  });

  it('is the interface language’s own name otherwise', () => {
    expect(languageName('vi', 'vi')).toBe('Tiếng Việt');
    expect(languageName('en', 'vi')).toBe('Tiếng Anh');
    expect(languageName('ja', 'vi-VN')).toBe('Tiếng Nhật');
  });

  it('keeps the English wording for a code the browser does not know, and for a blank one', () => {
    expect(languageName('x-made-up', 'vi')).toBe('x-made-up');
    expect(languageName('', 'vi')).toBe(languageLabel(''));
  });
});

describe('the value that reaches the prompt does not follow the interface language', () => {
  it('is the engine’s English label, whatever name is shown', () => {
    expect(languageName('vi', 'vi')).not.toBe('Vietnamese');
    expect(languageLabel('vi')).toBe('Vietnamese');
    const render = (vars: Readonly<Record<string, string>>) => `${vars.SOURCE_LANG}>${vars.TARGET_LANG}`;
    const system = renderSystemPromptV2(render, { sourceLang: 'en', targetLang: 'vi', style: 'natural', gloss: 'first', snippets: [] });
    expect(system).toBe('English>Vietnamese');
  });
});
