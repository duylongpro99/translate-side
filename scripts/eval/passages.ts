// Eval passages (plan M2-E8): eval/passages/<id>.md → the Segment[] the content script would have
// produced, so the engine runs on them unchanged. Format: a `---` front matter of `key: value`
// lines, then blocks separated by blank lines: `#`… headings, `- ` list items, `> ` quotes, fenced
// code, and paragraphs (their lines are joined). Inline: `code`, *em* / **strong** / _em_, [text](url).
import fs from 'node:fs';
import path from 'node:path';
import { hashId } from '@/segment/hash';
import type { Segment } from '@/engine/index';

export const CATEGORIES = ['tech-blog', 'docs', 'opinion', 'humor'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface PassageMeta {
  id: string;
  category: string;
  title: string;
  url: string;
  author: string;
  license: string;
  note?: string;
}

export interface Passage {
  meta: PassageMeta;
  lang: string;
  segments: Segment[];
}

const REQUIRED = ['id', 'category', 'title', 'url', 'author', 'license'] as const;

/** Markdown inline → the engine's light markers (`[link]…[/link]`, backticks, `*…*`), plus the plain text. */
export function inline(src: string): { text: string; markup: string } {
  let text = '';
  let markup = '';
  // Code spans are cut out first so their contents are never read as emphasis or links.
  for (const [i, part] of src.split(/(`[^`]*`)/).entries()) {
    if (i % 2 === 1) {
      text += part.slice(1, -1);
      markup += part;
      continue;
    }
    const m = part
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '[link]$1[/link]')
      .replace(/\*\*([^*]+)\*\*/g, '*$1*')
      .replace(/__([^_]+)__/g, '*$1*')
      .replace(/(^|[^\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu, '$1*$2*');
    markup += m;
    text += m.replace(/\[\/?link\]/g, '').replace(/\*([^*]+)\*/g, '$1');
  }
  return { text, markup };
}

function frontMatter(raw: string, file: string): { meta: PassageMeta; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${file}: no front matter`);
  const kv: Record<string, string> = {};
  for (const line of (m[1] as string).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of REQUIRED) if (!kv[k]) throw new Error(`${file}: front matter lacks "${k}"`);
  return { meta: kv as unknown as PassageMeta, body: m[2] as string };
}

export function parsePassage(raw: string, file = 'passage'): Passage {
  const { meta, body } = frontMatter(raw.replace(/\r\n/g, '\n'), file);
  const segments: Segment[] = [];
  const push = (kind: Segment['kind'], text: string, markup: string, extra: Partial<Segment> = {}): void => {
    const domPath = `/passage[1]/${kind}[${segments.length + 1}]`;
    segments.push({ id: hashId(`${meta.id}\n${domPath}\n${text}`), kind, text, inlineMarkup: markup, domPath, translate: kind !== 'code', ...extra });
  };
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = /^```\s*(\S*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i] as string); i++) code.push(lines[i] as string);
      i++;
      const text = code.join('\n');
      push('code', text, text, fence[1] ? { codeLang: fence[1] } : {});
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const { text, markup } = inline((h[2] as string).trim());
      push('heading', text, markup, { level: (h[1] as string).length });
      i++;
      continue;
    }
    if (/^- /.test(line)) {
      const { text, markup } = inline(line.slice(2).trim());
      push('li', text, markup);
      i++;
      continue;
    }
    const block: string[] = [];
    const quote = line.startsWith('>');
    for (; i < lines.length && (lines[i] as string).trim() !== '' && !/^```/.test(lines[i] as string); i++) {
      const l = lines[i] as string;
      if (!quote && (/^#{1,6}\s/.test(l) || /^- /.test(l))) break;
      block.push(quote ? l.replace(/^>\s?/, '') : l.trim());
    }
    const { text, markup } = inline(block.join(' ').trim());
    push(quote ? 'quote' : 'p', text, markup);
  }
  if (!segments.some((s) => s.translate)) throw new Error(`${file}: nothing to translate`);
  return { meta, lang: 'en', segments };
}

export function passageDir(root: string): string {
  return path.join(root, 'eval/passages');
}

export function loadPassage(root: string, id: string): Passage {
  const file = path.join(passageDir(root), `${id}.md`);
  const p = parsePassage(fs.readFileSync(file, 'utf8'), file);
  if (p.meta.id !== id) throw new Error(`${file}: id "${p.meta.id}" does not match the file name`);
  return p;
}

/** Passage ids in a fixed order: category (CATEGORIES order), then id. */
export function listPassageIds(root: string): string[] {
  const ids = fs.readdirSync(passageDir(root)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  const rank = (id: string): number => CATEGORIES.indexOf(loadPassage(root, id).meta.category as Category);
  return ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
