// Malformed-output corpus for the draft parser. Each case is fed in random-size deltas (seeded, 200 splits per case)
// so tag boundaries land mid-delta. Cases marked (seen) were observed in the gpt-oss:20b runs (see runs/ and S2 record).
// (B), (C), (D), bad id, text between segments and the cut close tag came from review round 1.
// Run: node corpus.test.mjs
import assert from 'node:assert/strict';
import { parseAll, plan } from './parser.mjs';

const src3 = { 1: 'One sentence here.', 2: 'Second sentence here.', 3: 'Third sentence.' };
const ids3 = [1, 2, 3];
// Sources for the literal-tag cases: the engine knows the source, so plan() compares literal tag counts against it.
const srcLit = { ...src3, 1: 'Write <seg id="9"> here' };
const srcSeen = { ...src3, 1: 'Type <seg id="2"> before and </seg> after.' };
const srcEnds = { ...src3, 3: 'Ends with </seg> literally.' };
const srcTail = { ...src3, 2: 'Tail </seg>' };
const srcAdj = { ...src3, 1: 'X </seg><seg id="2"> Y' };
const kinds = (r) => r.fixes.map((f) => f.kind).sort();
const CASES = [
  ['well-formed', '<seg id="1">A</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => { assert.ok(r.strict); assert.deepEqual(r.segs, { 1: 'A', 2: 'B', 3: 'C' }); }],
  ['literal < and > inside text', '<seg id="1">Vec<T> a < b, x>y</seg><seg id="2">`<div>`</seg><seg id="3">&lt;p&gt;</seg>', (r) => { assert.ok(r.strict); assert.equal(r.segs[1], 'Vec<T> a < b, x>y'); assert.equal(r.segs[2], '`<div>`'); }],
  ['single quotes', "<seg id='1'>A</seg><seg id='2'>B</seg><seg id='3'>C</seg>", (r) => { assert.ok(!r.strict); assert.deepEqual(Object.keys(r.segs), ['1', '2', '3']); assert.ok(kinds(r).every((k) => k === 'open-form')); }],
  ['unquoted id, spaces, caps', '<SEG id=1 >A</SEG><seg  id = "2">B< /seg><seg id="3">C</seg >', (r) => { assert.deepEqual(r.segs, { 1: 'A', 2: 'B', 3: 'C' }); }],
  ['missing segment', '<seg id="1">A</seg><seg id="3">C</seg>', (r) => { assert.deepEqual(r.missing, [2]); }],
  ['merged 1+2', '<seg id="1">One sentence here. Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => { const p = plan(r, src3); assert.deepEqual(p.merged, [1]); assert.deepEqual(p.rerequest, [1, 2]); }],
  ['no close before next open (v2: open is text → 2 missing, 1 re-requested with it)', '<seg id="1">One sentence here.<seg id="2">Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => { assert.deepEqual(r.missing, [2]); assert.deepEqual(kinds(r), ['open-in-text']); assert.deepEqual(plan(r, src3).rerequest, [1, 2]); }],
  ['code fence + preamble', 'Here is the translation:\n```xml\n<seg id="1">A</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>\n```', (r) => { assert.deepEqual(r.segs, { 1: 'A', 2: 'B', 3: 'C' }); assert.deepEqual(kinds(r), ['stray']); }],
  ['reordered', '<seg id="2">B</seg><seg id="1">A</seg><seg id="3">C</seg>', (r) => { assert.deepEqual(r.missing, []); assert.deepEqual(kinds(r), ['reorder']); }],
  ['duplicate id', '<seg id="1">A</seg><seg id="1">A2</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.equal(r.segs[1], 'A'); assert.deepEqual(kinds(r), ['dup']); }],
  ['unknown id', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">C</seg><seg id="4">D</seg>', (r) => { assert.deepEqual(kinds(r), ['unknown']); }],
  ['max_tokens cut mid-segment', '<seg id="1">A</seg><seg id="2">Half of B', (r) => { assert.deepEqual(r.cut, { id: 2, text: 'Half of B' }); assert.deepEqual(r.missing, [3]); }, 'max_tokens'],
  ['max_tokens cut inside a tag', '<seg id="1">A</seg><seg id="2">B</seg><seg id', (r) => { assert.equal(r.cut, null); assert.deepEqual(r.missing, [3]); assert.deepEqual(kinds(r), ['stray']); }, 'max_tokens'],
  ['end without close (stop=end)', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">C', (r) => { assert.equal(r.segs[3], 'C'); assert.deepEqual(kinds(r), ['unclosed-end']); }],
  ['orphan close', '<seg id="1">A</seg></seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.deepEqual(kinds(r), ['orphan-close']); }],
  ['empty segment', '<seg id="1">A</seg><seg id="2"></seg><seg id="3">C</seg>', (r) => { assert.deepEqual(plan(r, src3).empty, [2]); }],
  // Literal tags in the source, echoed by the model (seen in adv#0 with the unescaped source, and with the escaped source
  // when gpt-oss decoded the entities). v1 = plain lenient grammar; v2 = close-by-lookahead (the proposed grammar).
  ['v1: literal <seg in text → silent truncation, only the unknown id gives it away', '<seg id="1">Write <seg id="9"> here</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.equal(r.segs[1], 'Write '); assert.deepEqual(r.missing, []); assert.deepEqual(plan(r, src3).truncated, [1]); assert.ok(plan(r, src3).ambiguous); }, 'end', 'v1'],
  ['v2: literal <seg in text stays text', '<seg id="1">Write <seg id="9"> here</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.equal(r.segs[1], 'Write <seg id="9"> here'); assert.deepEqual(kinds(r), ['open-in-text']); assert.deepEqual(plan(r, srcLit).rerequest, []); }],
  ['v1 (seen): literal <seg id="2"> and </seg> → dup + orphan-close, wrong text under id 2', '<seg id="1">Type <seg id="2"> before and </seg> after.</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => { assert.equal(r.segs[2], ' before and '); assert.deepEqual(plan(r, src3).rerequest, [1, 2, 3]); }, 'end', 'v1'],
  ['v2 (seen): same output parses right', '<seg id="1">Type <seg id="2"> before and </seg> after.</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => { assert.equal(r.segs[1], 'Type <seg id="2"> before and </seg> after.'); assert.equal(r.segs[2], 'B'); assert.deepEqual(plan(r, srcSeen).rerequest, []); }],
  ['v2: literal </seg> as the last thing in a segment, then stray prose', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">Ends with </seg> literally.</seg>\nDone!', (r) => { assert.equal(r.segs[3], 'Ends with </seg> literally.'); assert.deepEqual(kinds(r), ['close-in-text', 'stray']); assert.deepEqual(plan(r, srcEnds).rerequest, []); }],
  // Review round 1 (tester and reviewer): the cases v2 alone does not make safe, and malformed opens.
  ['L-end (D): last segment holds a literal </seg> and the model drops the final </seg> → truncated; tag count catches it', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">Ends with </seg> literally.', (r) => { assert.equal(r.segs[3], 'Ends with '); assert.deepEqual(kinds(r), ['stray']); assert.deepEqual(plan(r, srcEnds).tagMismatch, [3]); assert.deepEqual(plan(r, srcEnds).rerequest, [3]); }],
  ['L-tail (B): segment text ends with a literal </seg> → orphan close → whole chunk', '<seg id="1">A</seg><seg id="2">Tail </seg></seg><seg id="3">C</seg>', (r) => { assert.equal(r.segs[2], 'Tail '); assert.deepEqual(kinds(r), ['orphan-close']); assert.deepEqual(plan(r, srcTail).rerequest, [1, 2, 3]); }],
  ['L-adjacent (C): literal </seg><seg id=2> inside segment 1 → dup → whole chunk', '<seg id="1">X </seg><seg id="2"> Y</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.equal(r.segs[2], ' Y'); assert.deepEqual(kinds(r), ['dup']); assert.ok(plan(r, srcAdj).ambiguous); }],
  ['bad id (tester): </seg><seg id=x> is a close plus an open with a bad id, never text', '<seg id="1">A</seg><seg id="x">garbage</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.deepEqual(r.segs, { 1: 'A', 2: 'B', 3: 'C' }); assert.deepEqual(kinds(r), ['bad-id']); assert.ok(plan(r, src3).ambiguous); }],
  ['bad id: "<seg>" with no id, outside a segment', '<seg>A</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.deepEqual(r.missing, [1]); assert.deepEqual(kinds(r), ['bad-id']); assert.ok(plan(r, src3).ambiguous); }],
  ['"<segment>" is not a tag', '<seg id="1">A <segment> B</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => { assert.ok(r.strict); assert.equal(r.segs[1], 'A <segment> B'); }],
  ['text between segments (v2): the close is read as text → 1 and 2 merged, both re-requested', '<seg id="1">One sentence here.</seg> (note) <seg id="2">Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => { assert.deepEqual(r.missing, [2]); assert.deepEqual(plan(r, src3).rerequest, [1, 2]); }],
  ['text between segments (v1): the note is stray, nothing re-requested', '<seg id="1">One sentence here.</seg> (note) <seg id="2">Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => { assert.deepEqual(r.missing, []); assert.deepEqual(kinds(r), ['stray']); assert.deepEqual(plan(r, src3).rerequest, []); }, 'end', 'v1'],
  ['cut inside a close tag: "</se" never reaches the partial text', '<seg id="1">A</seg><seg id="2">Half of B</se', (r) => { assert.deepEqual(r.cut, { id: 2, text: 'Half of B' }); }, 'max_tokens'],
  ['empty and whitespace-only segments: strict (tags are fine) but re-requested', '<seg id="1">A</seg><seg id="2"> </seg><seg id="3"></seg>', (r) => { assert.ok(r.strict); assert.deepEqual(plan(r, src3).empty, [2, 3]); assert.deepEqual(plan(r, src3).rerequest, [2, 3]); }],
  ['nothing but prose', 'I cannot help with that.', (r) => { assert.deepEqual(r.missing, [1, 2, 3]); }],
];
let seed = 7; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let ok = 0;
for (const [name, text, check, stop = 'end', grammar = 'v2'] of CASES) {
  let first;
  for (let k = 0; k < 200; k++) {
    const r = parseAll(text, ids3, stop, { rng, maxDelta: 1 + (k % 9), grammar });
    first ??= JSON.stringify(r);
    assert.equal(JSON.stringify(r), first, `${name}: result depends on delta split`);
  }
  try { check(JSON.parse(first)); ok++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message, first); process.exitCode = 1; }
}
console.log(`${ok}/${CASES.length} corpus cases pass (each under 200 random delta splits)`);
