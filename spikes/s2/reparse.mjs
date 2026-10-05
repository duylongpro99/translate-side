// Offline re-parse of a stored run row (its raw `content`) with a given grammar, plus the post-parse checks.
import fs from 'node:fs';
import { SegParser, plan, unesc } from './parser.mjs';
import { markerCheck, isUntranslated } from './checks.mjs';
const J = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url)));
export const CH = Object.fromEntries([...J('chunks.json'), ...J('adversarial.json'), ...J('chunks-large.json')].map((c) => [c.id, c]));
export function reparse(r, grammar) {
  const c = r.subSegs ? { segs: r.subSegs } : CH[r.chunk];
  const src = Object.fromEntries(c.segs.map((s) => [s.id, s.text]));
  const p = new SegParser(c.segs.map((s) => s.id), { grammar });
  p.push(r.content);
  const res = p.end(r.finish === 'length' ? 'max_tokens' : r.finish === 'stop' ? 'end' : 'other');
  if (r.escape) for (const id of Object.keys(res.segs)) res.segs[id] = unesc(res.segs[id]);
  const pl = plan(res, src);
  const markers = Object.fromEntries(Object.entries(res.segs).map(([id, t]) => [id, markerCheck(src[id], t)]).filter(([, v]) => v.length));
  const untranslated = Object.entries(res.segs).filter(([id, t]) => isUntranslated(src[id], t)).length;
  return { res, pl, markers, untranslated };
}

