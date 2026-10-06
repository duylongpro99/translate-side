import fs from 'node:fs';
import path from 'node:path';
import { extractPage } from '@/extract';
import { estimateTokens } from '@/engine/tokens';
import { FIXTURES, loadFixture, manifest } from '../../tests/fixtures/load.ts';
import { EVAL_SLUGS } from './docs.ts';

const OUT = path.join(FIXTURES, 'docs');
const wanted = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
for (const slug of wanted.length ? wanted : EVAL_SLUGS) {
  const r = extractPage(loadFixture(slug));
  if (!r.ok) {
    console.error(`${slug}: ${r.reason}`);
    process.exitCode = 1;
    continue;
  }
  const doc = { slug, via: r.via, url: r.url, title: r.title, lang: r.lang ?? 'en', generator: manifest[slug]?.generator, segments: r.segments };
  fs.writeFileSync(path.join(OUT, `${slug}.json`), `${JSON.stringify(doc, null, 1)}\n`);
  const tr = r.segments.filter((s) => s.translate);
  const tokens = tr.reduce((n, s) => n + estimateTokens(s.inlineMarkup), 0);
  console.log(`${slug.padEnd(36)} ${r.via.padEnd(11)} segs ${String(r.segments.length).padStart(4)} translatable ${String(tr.length).padStart(4)} ~${tokens} tok`);
}
