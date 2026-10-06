import { describe, expect, it } from 'vitest';
import { classifyUrl } from './denylist.ts';

describe('classifyUrl', () => {
  it.each([
    'https://developer.mozilla.org/en-US/docs/Web',
    'http://localhost:3000/docs',
    'file:///tmp/page.html',
    'https://notmail.google.com.example/',
  ])('reads %s', (url) => {
    expect(classifyUrl(url)).toEqual({ ok: true });
  });

  it.each([
    'chrome://extensions/',
    'chrome-extension://abc/sidepanel.html',
    'edge://settings',
    'about:blank',
    'view-source:https://example.com/',
    'devtools://devtools/bundled/inspector.html',
    'https://chromewebstore.google.com/detail/abc',
    'https://chrome.google.com/webstore/detail/abc',
    'not a url',
    undefined,
  ])('cannot read %s', (url) => {
    expect(classifyUrl(url)).toEqual({ ok: false, reason: 'restricted' });
  });

  it.each(['https://mail.google.com/mail/u/0/', 'https://outlook.office.com/mail/', 'https://eu.mail.proton.me/'])(
    'never reads the denylisted %s',
    (url) => {
      expect(classifyUrl(url)).toEqual({ ok: false, reason: 'denylisted' });
    },
  );

  it('keeps the rest of chrome.google.com readable', () => {
    expect(classifyUrl('https://chrome.google.com/intl/en/')).toEqual({ ok: true });
  });
});
