// Golden corpus for the <seg> parser and the repair plan (plan M1-E12, criterion 4). The S2 corpus
// (spikes/s2/corpus.test.mjs, 32 cases) is ported case by case, then the M1-E3 additions: v1 (the
// default grammar under option C) on the malformed shapes, and the per-chunk nonce. Every case is
// fed in 200 seeded random delta splits; the result must not depend on the split.

import { describe, expect, it } from 'vitest';
import { planRepair } from './repair.ts';
import { SegParser, literalTagCount, parseOutput, type Grammar, type ParseResult } from './seg-parser.ts';
import type { StopReason } from '../../llm/types.ts';

const ids3 = [1, 2, 3];
const src = (over: Record<number, string> = {}): Map<number, string> =>
  new Map(Object.entries({ 1: 'One sentence here.', 2: 'Second sentence here.', 3: 'Third sentence.', ...over }).map(([k, v]) => [Number(k), v]));
const src3 = src();
const srcLit = src({ 1: 'Write <seg id="9"> here' });
const srcSeen = src({ 1: 'Type <seg id="2"> before and </seg> after.' });
const srcEnds = src({ 3: 'Ends with </seg> literally.' });
const srcTail = src({ 2: 'Tail </seg>' });
const srcAdj = src({ 1: 'X </seg><seg id="2"> Y' });

export function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

interface Out {
  strict: boolean;
  segs: Record<number, string>;
  missing: number[];
  cut: ParseResult['cut'];
  kinds: string[];
  stray: string;
}

const view = (r: ParseResult): Out => ({
  strict: r.strict,
  segs: Object.fromEntries(r.segs),
  missing: r.missing,
  cut: r.cut,
  kinds: r.fixes.map((f) => f.kind).sort(),
  stray: r.stray,
});

/** Parses under 200 random splits, checks they all agree, returns the result. */
function parse(text: string, opts: { stop?: StopReason; grammar?: Grammar; nonce?: string; ids?: number[] } = {}): ParseResult {
  const rng = lcg(7);
  let first: ParseResult | undefined;
  for (let k = 0; k < 200; k++) {
    const max = 1 + (k % 9);
    const r = parseOutput(text, opts.ids ?? ids3, opts.stop ?? 'end', {
      grammar: opts.grammar ?? 'v1',
      ...(opts.nonce === undefined ? {} : { nonce: opts.nonce }),
      deltas: () => 1 + Math.floor(rng() * max),
    });
    if (first === undefined) first = r;
    else expect(view(r)).toEqual(view(first));
  }
  return first as ParseResult;
}

type Case = [name: string, output: string, check: (r: ParseResult) => void, opts?: { stop?: StopReason; grammar?: Grammar; nonce?: string }];
const v2 = { grammar: 'v2' } as const;
const plan = (r: ParseResult, s = src3) => planRepair(r, s);

// The S2 corpus. S2 ran v2 by default; the grammar is explicit here.
const S2_CORPUS: Case[] = [
  ['well-formed', '<seg id="1">A</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => {
    expect(r.strict).toBe(true);
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
  }, v2],
  ['literal < and > inside text', '<seg id="1">Vec<T> a < b, x>y</seg><seg id="2">`<div>`</seg><seg id="3">&lt;p&gt;</seg>', (r) => {
    expect(r.strict).toBe(true);
    expect(r.segs.get(1)).toBe('Vec<T> a < b, x>y');
    expect(r.segs.get(2)).toBe('`<div>`');
  }, v2],
  ['single quotes', "<seg id='1'>A</seg><seg id='2'>B</seg><seg id='3'>C</seg>", (r) => {
    expect(r.strict).toBe(false);
    expect([...r.segs.keys()]).toEqual([1, 2, 3]);
    expect(view(r).kinds.every((k) => k === 'open-form')).toBe(true);
  }, v2],
  ['unquoted id, spaces, caps', '<SEG id=1 >A</SEG><seg  id = "2">B< /seg><seg id="3">C</seg >', (r) => {
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
  }, v2],
  ['missing segment', '<seg id="1">A</seg><seg id="3">C</seg>', (r) => expect(r.missing).toEqual([2]), v2],
  ['merged 1+2', '<seg id="1">One sentence here. Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => {
    expect(plan(r).merged).toEqual([1]);
    expect(plan(r).rerequest).toEqual([1, 2]);
  }, v2],
  ['no close before next open (v2: open is text → 2 missing, 1 re-requested with it)', '<seg id="1">One sentence here.<seg id="2">Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => {
    expect(r.missing).toEqual([2]);
    expect(view(r).kinds).toEqual(['open-in-text']);
    expect(plan(r).rerequest).toEqual([1, 2]);
  }, v2],
  ['code fence + preamble', 'Here is the translation:\n```xml\n<seg id="1">A</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>\n```', (r) => {
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
    expect(view(r).kinds).toEqual(['stray']);
  }, v2],
  ['reordered', '<seg id="2">B</seg><seg id="1">A</seg><seg id="3">C</seg>', (r) => {
    expect(r.missing).toEqual([]);
    expect(view(r).kinds).toEqual(['reorder']);
  }, v2],
  ['duplicate id', '<seg id="1">A</seg><seg id="1">A2</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(r.segs.get(1)).toBe('A');
    expect(view(r).kinds).toEqual(['dup']);
  }, v2],
  ['unknown id', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">C</seg><seg id="4">D</seg>', (r) => expect(view(r).kinds).toEqual(['unknown']), v2],
  ['max_tokens cut mid-segment', '<seg id="1">A</seg><seg id="2">Half of B', (r) => {
    expect(r.cut).toEqual({ id: 2, text: 'Half of B' });
    expect(r.missing).toEqual([3]);
  }, { ...v2, stop: 'max_tokens' }],
  ['max_tokens cut inside a tag', '<seg id="1">A</seg><seg id="2">B</seg><seg id', (r) => {
    expect(r.cut).toBeNull();
    expect(r.missing).toEqual([3]);
    expect(view(r).kinds).toEqual(['stray']);
  }, { ...v2, stop: 'max_tokens' }],
  ['end without close (stop=end)', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">C', (r) => {
    expect(r.segs.get(3)).toBe('C');
    expect(view(r).kinds).toEqual(['unclosed-end']);
  }, v2],
  ['orphan close', '<seg id="1">A</seg></seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => expect(view(r).kinds).toEqual(['orphan-close']), v2],
  ['empty segment', '<seg id="1">A</seg><seg id="2"></seg><seg id="3">C</seg>', (r) => expect(plan(r).empty).toEqual([2]), v2],
  ['v1: literal <seg in text → silent truncation, only the unknown id gives it away', '<seg id="1">Write <seg id="9"> here</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(r.segs.get(1)).toBe('Write ');
    expect(r.missing).toEqual([]);
    expect(plan(r).truncated).toEqual([1]);
    expect(plan(r).ambiguous).toBe(true);
  }, { grammar: 'v1' }],
  ['v2: literal <seg in text stays text', '<seg id="1">Write <seg id="9"> here</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(r.segs.get(1)).toBe('Write <seg id="9"> here');
    expect(view(r).kinds).toEqual(['open-in-text']);
    expect(plan(r, srcLit).rerequest).toEqual([]);
  }, v2],
  ['v1 (seen): literal <seg id="2"> and </seg> → dup + orphan-close, wrong text under id 2', '<seg id="1">Type <seg id="2"> before and </seg> after.</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => {
    expect(r.segs.get(2)).toBe(' before and ');
    expect(plan(r).rerequest).toEqual([1, 2, 3]);
  }, { grammar: 'v1' }],
  ['v2 (seen): same output parses right', '<seg id="1">Type <seg id="2"> before and </seg> after.</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => {
    expect(r.segs.get(1)).toBe('Type <seg id="2"> before and </seg> after.');
    expect(r.segs.get(2)).toBe('B');
    expect(plan(r, srcSeen).rerequest).toEqual([]);
  }, v2],
  ['v2: literal </seg> as the last thing in a segment, then stray prose', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">Ends with </seg> literally.</seg>\nDone!', (r) => {
    expect(r.segs.get(3)).toBe('Ends with </seg> literally.');
    expect(view(r).kinds).toEqual(['close-in-text', 'stray']);
    expect(plan(r, srcEnds).rerequest).toEqual([]);
  }, v2],
  ['L-end (D): last segment holds a literal </seg> and the model drops the final </seg> → truncated; tag count catches it', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">Ends with </seg> literally.', (r) => {
    expect(r.segs.get(3)).toBe('Ends with ');
    expect(view(r).kinds).toEqual(['stray']);
    expect(plan(r, srcEnds).tagMismatch).toEqual([3]);
    expect(plan(r, srcEnds).rerequest).toEqual([3]);
  }, v2],
  ['L-tail (B): segment text ends with a literal </seg> → orphan close → whole chunk', '<seg id="1">A</seg><seg id="2">Tail </seg></seg><seg id="3">C</seg>', (r) => {
    expect(r.segs.get(2)).toBe('Tail ');
    expect(view(r).kinds).toEqual(['orphan-close']);
    expect(plan(r, srcTail).rerequest).toEqual([1, 2, 3]);
  }, v2],
  ['L-adjacent (C): literal </seg><seg id=2> inside segment 1 → dup → whole chunk', '<seg id="1">X </seg><seg id="2"> Y</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(r.segs.get(2)).toBe(' Y');
    expect(view(r).kinds).toEqual(['dup']);
    expect(plan(r, srcAdj).ambiguous).toBe(true);
  }, v2],
  ['bad id (tester): </seg><seg id=x> is a close plus an open with a bad id, never text', '<seg id="1">A</seg><seg id="x">garbage</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
    expect(view(r).kinds).toEqual(['bad-id']);
    expect(plan(r).ambiguous).toBe(true);
  }, v2],
  ['bad id: "<seg>" with no id, outside a segment', '<seg>A</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(r.missing).toEqual([1]);
    expect(view(r).kinds).toEqual(['bad-id']);
    expect(plan(r).ambiguous).toBe(true);
  }, v2],
  ['"<segment>" is not a tag', '<seg id="1">A <segment> B</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(r.strict).toBe(true);
    expect(r.segs.get(1)).toBe('A <segment> B');
  }, v2],
  ['text between segments (v2): the close is read as text → 1 and 2 merged, both re-requested', '<seg id="1">One sentence here.</seg> (note) <seg id="2">Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => {
    expect(r.missing).toEqual([2]);
    expect(plan(r).rerequest).toEqual([1, 2]);
  }, v2],
  ['text between segments (v1): the note is stray, nothing re-requested', '<seg id="1">One sentence here.</seg> (note) <seg id="2">Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => {
    expect(r.missing).toEqual([]);
    expect(view(r).kinds).toEqual(['stray']);
    expect(plan(r).rerequest).toEqual([]);
  }, { grammar: 'v1' }],
  ['cut inside a close tag: "</se" never reaches the partial text', '<seg id="1">A</seg><seg id="2">Half of B</se', (r) => {
    expect(r.cut).toEqual({ id: 2, text: 'Half of B' });
  }, { ...v2, stop: 'max_tokens' }],
  ['empty and whitespace-only segments: strict (tags are fine) but re-requested', '<seg id="1">A</seg><seg id="2"> </seg><seg id="3"></seg>', (r) => {
    expect(r.strict).toBe(true);
    expect(plan(r).empty).toEqual([2, 3]);
    expect(plan(r).rerequest).toEqual([2, 3]);
  }, v2],
  ['nothing but prose', 'I cannot help with that.', (r) => expect(r.missing).toEqual([1, 2, 3]), v2],
];

// M1-E3: v1 is the default grammar (option C), so the malformed shapes are checked under it too.
const V1_CASES: Case[] = [
  ['v1 well-formed is strict', '<seg id="1">A</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => expect(r.strict).toBe(true)],
  ['v1 no close before next open → implicit close, nothing missing', '<seg id="1">A<seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
    expect(view(r).kinds).toEqual(['implicit-close']);
    expect(plan(r).rerequest).toEqual([]);
  }],
  ['v1 merged 1+2', '<seg id="1">One sentence here. Second sentence here.</seg><seg id="3">Third sentence.</seg>', (r) => expect(plan(r).rerequest).toEqual([1, 2])],
  ['v1 reordered', '<seg id="3">C</seg><seg id="1">A</seg><seg id="2">B</seg>', (r) => {
    expect(r.missing).toEqual([]);
    expect(view(r).kinds).toEqual(['reorder', 'reorder']);
    expect(plan(r).rerequest).toEqual([]);
  }],
  ['v1 unclosed last segment (gpt-oss slip)', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">C\n', (r) => {
    expect(r.segs.get(3)).toBe('C\n');
    expect(view(r).kinds).toEqual(['unclosed-end']);
    expect(plan(r).rerequest).toEqual([]);
  }],
  ['v1 cut mid-segment', '<seg id="1">A</seg><seg id="2">Hal', (r) => {
    expect(r.cut).toEqual({ id: 2, text: 'Hal' });
    expect(plan(r).rerequest).toEqual([2, 3]);
  }, { stop: 'max_tokens' }],
  ['v1 cut before any content', '', (r) => expect(plan(r).rerequest).toEqual([1, 2, 3]), { stop: 'max_tokens' }],
  ['v1 cut inside the closing tag', '<seg id="1">A</seg><seg id="2">B</', (r) => expect(r.cut).toEqual({ id: 2, text: 'B' }), { stop: 'max_tokens' }],
  ['v1 cut inside the next open tag', '<seg id="1">A</seg><seg id="2">B</seg><seg id="', (r) => {
    expect(r.cut).toBeNull();
    expect(plan(r).rerequest).toEqual([3]);
  }, { stop: 'max_tokens' }],
  ['v1 literal < that never becomes a tag (long, no >)', `<seg id="1">a <${'x'.repeat(50)}</seg><seg id="2">B</seg><seg id="3">C</seg>`, (r) => {
    expect(r.strict).toBe(true);
    expect(r.segs.get(1)).toBe(`a <${'x'.repeat(50)}`);
  }],
  ['v1 "<s" at the very end of a complete answer is stray', '<seg id="1">A</seg><seg id="2">B</seg><seg id="3">C</seg><s', (r) => {
    expect(view(r).kinds).toEqual(['stray']);
    expect(plan(r).rerequest).toEqual([]);
  }],
  ['v1 empty id attribute → bad id → whole chunk', '<seg id="">A</seg><seg id="2">B</seg><seg id="3">C</seg>', (r) => {
    expect(view(r).kinds).toEqual(['bad-id']);
    expect(plan(r).rerequest).toEqual([1, 2, 3]);
  }],
  ['v1 refusal stop: unclosed text is accepted, the rest missing', '<seg id="1">A', (r) => expect(plan(r).rerequest).toEqual([2, 3]), { stop: 'refusal' }],
];

// M1-E3: the per-chunk nonce on chunks with literal tags (v2).
const N = 'k7q2';
const nonce = { grammar: 'v2', nonce: N } as const;
const NONCE_CASES: Case[] = [
  ['nonce: well-formed is strict', `<seg id="1" n="${N}">A</seg><seg id="2" n="${N}">B</seg><seg id="3" n="${N}">C</seg>`, (r) => {
    expect(r.strict).toBe(true);
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
  }, nonce],
  ['nonce: L-adjacent parses right (the literal open has no nonce)', `<seg id="1" n="${N}">X </seg><seg id="2"> Y</seg><seg id="2" n="${N}">B</seg><seg id="3" n="${N}">C</seg>`, (r) => {
    expect(view(r).segs).toEqual({ 1: 'X </seg><seg id="2"> Y', 2: 'B', 3: 'C' });
    expect(plan(r, srcAdj).rerequest).toEqual([]);
  }, nonce],
  ['nonce: L-tail parses right (the last close of a run closes)', `<seg id="1" n="${N}">A</seg><seg id="2" n="${N}">Tail </seg></seg><seg id="3" n="${N}">C</seg>`, (r) => {
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'Tail </seg>', 3: 'C' });
    expect(plan(r, srcTail).rerequest).toEqual([]);
  }, nonce],
  ['nonce: L-tail as the last segment, final close present', `<seg id="1" n="${N}">A</seg><seg id="2" n="${N}">B</seg><seg id="3" n="${N}">Ends with </seg></seg>`, (r) => {
    expect(r.segs.get(3)).toBe('Ends with </seg>');
    expect(plan(r, src({ 3: 'Ends with </seg>' })).rerequest).toEqual([]);
  }, nonce],
  ['nonce: seen adv#0 shape parses right', `<seg id="1" n="${N}">Type <seg id="2"> before and </seg> after.</seg>\n<seg id="2" n="${N}">B</seg>\n<seg id="3" n="${N}">C</seg>`, (r) => {
    expect(r.segs.get(1)).toBe('Type <seg id="2"> before and </seg> after.');
    expect(plan(r, srcSeen).rerequest).toEqual([]);
  }, nonce],
  ['nonce: a model double close on plain text is caught by the tag count', `<seg id="1" n="${N}">A</seg></seg><seg id="2" n="${N}">B</seg><seg id="3" n="${N}">C</seg>`, (r) => {
    expect(r.segs.get(1)).toBe('A</seg>');
    expect(plan(r).rerequest).toEqual([1]);
  }, nonce],
  ['nonce: L-end is still caught by the tag count', `<seg id="1" n="${N}">A</seg><seg id="2" n="${N}">B</seg><seg id="3" n="${N}">Ends with </seg> literally.`, (r) => {
    expect(r.segs.get(3)).toBe('Ends with ');
    expect(plan(r, srcEnds).rerequest).toEqual([3]);
  }, nonce],
  ['nonce not copied: plain v2, flagged once, nothing re-requested', '<seg id="1">Type <seg id="2"> before and </seg> after.</seg>\n<seg id="2">B</seg>\n<seg id="3">C</seg>', (r) => {
    expect(r.segs.get(1)).toBe('Type <seg id="2"> before and </seg> after.');
    expect(view(r).kinds).toEqual(['close-in-text', 'nonce-missing', 'open-in-text']);
    expect(plan(r, srcSeen).rerequest).toEqual([]);
  }, nonce],
  ['nonce dropped on one tag after being copied: merged and re-requested, never silent', `<seg id="1" n="${N}">One sentence here.</seg><seg id="2">Second sentence here.</seg><seg id="3" n="${N}">Third sentence.</seg>`, (r) => {
    expect(r.missing).toEqual([2]);
    expect(plan(r).rerequest).toEqual([1, 2]);
  }, nonce],
  ['nonce: quoting drift on a nonce tag is a lenient open', `<seg id='1' n='${N}'>A</seg><SEG ID=2 N=${N}>B</seg><seg n="${N}" id="3">C</seg>`, (r) => {
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
    expect(view(r).kinds).toEqual(['open-form', 'open-form', 'open-form']);
  }, nonce],
  ['nonce: wrong nonce on the first tag → treated as not copied', '<seg id="1" n="zzzz">A</seg><seg id="2" n="zzzz">B</seg><seg id="3" n="zzzz">C</seg>', (r) => {
    expect(view(r).segs).toEqual({ 1: 'A', 2: 'B', 3: 'C' });
    expect(plan(r).rerequest).toEqual([]);
  }, nonce],
  ['nonce: cut inside the next nonce tag closes the previous segment', `<seg id="1" n="${N}">A</seg><seg id="2" n="${N}">B</seg><seg id="3" n="k7`, (r) => {
    expect(r.cut).toBeNull();
    expect(plan(r).rerequest).toEqual([3]);
  }, { ...nonce, stop: 'max_tokens' }],
];

describe('S2 corpus (golden, 200 splits each)', () => {
  it.each(S2_CORPUS)('%s', (_name, output, check, opts) => check(parse(output, opts)));
});

describe('v1 malformed shapes (golden, 200 splits each)', () => {
  it.each(V1_CASES)('%s', (_name, output, check, opts) => check(parse(output, opts)));
});

describe('nonce (golden, 200 splits each)', () => {
  it.each(NONCE_CASES)('%s', (_name, output, check, opts) => check(parse(output, opts)));
});

describe('SegParser callbacks', () => {
  it('streams cumulative partial text and finals; no partial for unknown or already-final ids', () => {
    const events: string[] = [];
    const p = new SegParser([1, 2], {
      onPartial: (id, text) => events.push(`p${id}:${text}`),
      onFinal: (id, text) => events.push(`f${id}:${text}`),
    });
    for (const d of ['<seg id="1">He', 'llo</s', 'eg><seg id="9">x</seg><seg id="1">dup</seg>', '<seg id="2">W']) p.push(d);
    const r = p.end('end');
    expect(events).toEqual(['p1:He', 'p1:Hello', 'f1:Hello', 'p2:W', 'f2:W']);
    expect(view(r).kinds).toEqual(['dup', 'unclosed-end', 'unknown']);
  });

  it('holds back a possible tag (at most MAX_TAG chars) and never streams it as text', () => {
    const partials: string[] = [];
    const p = new SegParser([1], { onPartial: (_id, text) => partials.push(text) });
    p.push('<seg id="1">a <se');
    expect(partials).toEqual(['a ']);
    p.push('x');
    expect(partials.at(-1)).toBe('a <sex');
    p.end('end');
  });

  it('rejects use after end', () => {
    const p = new SegParser([1]);
    p.end('end');
    expect(() => p.push('x')).toThrow();
    expect(() => p.end('end')).toThrow();
  });

  it('counts literal tag-shaped strings', () => {
    expect(literalTagCount('a <seg id="2"> b </seg> <SEG> < /seg> <segment> Vec<T>')).toBe(4);
  });
});
