// Text contrast in every theme, computed from tokens.css itself (WCAG 2.x relative luminance).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties declared in the first block whose selector is `selector`, after `from` when given. */
function block(selector: string, from = 0): Record<string, string> {
  const start = css.indexOf(`${selector} {`, from);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

const light = block(':root');
const systemDark = () => block(':root:not([data-theme])', css.indexOf('@media (prefers-color-scheme: dark)'));
const themes: Record<string, Record<string, string>> = {
  light,
  paper: { ...light, ...block(":root[data-theme='paper']") },
  dark: { ...light, ...block(":root[data-theme='dark']") },
  'system dark': { ...light, ...systemDark() },
};

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt((m[1] as string).slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('tokens', () => {
  it('declare every color token in every theme', () => {
    const names = ['--ground', '--ink', '--muted', '--line', '--tint', '--pressed', '--raised', '--accent', '--on-accent', '--danger', '--warn', '--ok', '--code-bg', '--hidden', '--quote'];
    for (const [name, t] of Object.entries(themes)) for (const n of names) expect(t[n], `${name} ${n}`).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('give the system dark theme the same values as data-theme="dark"', () => {
    expect(systemDark()).toEqual(block(":root[data-theme='dark']"));
  });

  it.each(Object.keys(themes))('keep text at 4.5:1 or more in the %s theme', (name) => {
    const t = themes[name] as Record<string, string>;
    for (const bg of ['--ground', '--raised', '--tint']) {
      for (const fg of ['--ink', '--muted', '--accent', '--danger', '--warn', '--ok', '--hidden', '--quote']) {
        expect(ratio(t[fg] as string, t[bg] as string), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(ratio(t['--ink'] as string, t['--code-bg'] as string), '--ink on --code-bg').toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['--on-accent'] as string, t['--accent'] as string), '--on-accent on --accent').toBeGreaterThanOrEqual(4.5);
  });
});
