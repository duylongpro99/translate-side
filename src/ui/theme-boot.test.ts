// @vitest-environment jsdom
// public/theme-boot.js: the classic script in each page's <head> that sets the theme before the first paint.
import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { READING_MIRROR } from './theme';

const boot = fs.readFileSync('public/theme-boot.js', 'utf8');
const run = () => new Function(boot)();
const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete root.dataset.theme;
});

describe('theme-boot.js', () => {
  it('reads the same mirror as theme.ts', () => {
    expect(boot).toContain(`'${READING_MIRROR}'`);
  });

  it('sets light, paper and dark from the mirror', () => {
    for (const theme of ['light', 'paper', 'dark']) {
      localStorage.setItem(READING_MIRROR, JSON.stringify({ theme, size: 18 }));
      run();
      expect(root.dataset.theme).toBe(theme);
    }
  });

  it('leaves the system theme for system, an unknown theme, a corrupt mirror or none', () => {
    for (const raw of [JSON.stringify({ theme: 'system' }), JSON.stringify({ theme: 'neon' }), '{nope', 'null', null]) {
      if (raw === null) localStorage.removeItem(READING_MIRROR);
      else localStorage.setItem(READING_MIRROR, raw);
      run();
      expect(root.hasAttribute('data-theme')).toBe(false);
    }
  });
});
