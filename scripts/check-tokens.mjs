// Colors come only from the design tokens (docs/design-system.md). Fails when a color literal (hex,
// rgb(), rgba(), hsl(), hsla() and the other color functions) or a system color keyword (Canvas,
// CanvasText, Field, LinkText and the rest, in any case) appears in a stylesheet under src/ other than
// src/ui/tokens.css, or in a literal `style=` value in a .tsx file. Named colors (red, white) are not
// checked; review catches those.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = 'src';
const TOKENS = join('src', 'ui', 'tokens.css');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const SYSTEM = /\b(?:Canvas|CanvasText|Field|FieldText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Highlight|HighlightText|SelectedItem|SelectedItemText|GrayText|Mark|MarkText|AccentColor|AccentColorText)\b/i;
/** A value without its quoted strings (`content: 'Mark'` names no color). */
const unquoted = (value) => value.replace(/'[^']*'|"[^"]*"/g, '""');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

/** 1-based line of `index` in `text`. */
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const problems = [];
for (const file of files(SRC)) {
  const name = relative('.', file).split(sep).join('/');
  if (file.endsWith('.css') && file !== TOKENS) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    // Declaration values only: from a property's colon to its semicolon or closing brace.
    for (const m of text.matchAll(/(?<=[{;]\s*)[-\w]+\s*:([^;{}]*)/g)) {
      const value = unquoted(m[1]);
      const hit = LITERAL.exec(value) ?? SYSTEM.exec(value);
      if (hit) problems.push(`${name}:${lineOf(text, m.index)}: "${hit[0]}" in "${m[0].trim()}"`);
    }
  } else if (file.endsWith('.tsx')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/style=(\{\{[^}]*\}\}|\{[^}]*\}|"[^"]*"|'[^']*')/g)) {
      const hit = LITERAL.exec(m[1]) ?? SYSTEM.exec(m[1]);
      if (hit) problems.push(`${name}:${lineOf(text, m.index)}: "${hit[0]}" in ${m[0]}`);
    }
  }
}

if (problems.length) {
  console.error(`check-tokens: ${problems.length} color(s) outside ${TOKENS}; use a token instead:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-tokens: no color literal or system color outside ${TOKENS}`);
