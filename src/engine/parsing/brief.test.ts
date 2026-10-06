import { describe, expect, it } from 'vitest';
import { BRIEF_FIELD_MAX, BRIEF_GLOSSARY_MAX, parseBrief } from './brief.ts';

const full = {
  language: 'en',
  genre: 'technical blog post',
  audience: 'intermediate Rust developers',
  purpose: 'explain why futures are lazy',
  tone: "conversational, uses 'we'",
  glossary: [
    { term: 'future', rendering: 'future', note: 'core concept, keep English' },
    { term: 'executor', rendering: 'executor' },
  ],
};
const json = JSON.stringify(full, null, 2);

describe('parseBrief (plan M2 criterion 5: never fails, falls back to no brief)', () => {
  it('accepts bare JSON', () => {
    expect(parseBrief(json)).toEqual(full);
  });

  it('accepts a ```json fence, a bare ``` fence, and a fence without a newline', () => {
    expect(parseBrief(`\`\`\`json\n${json}\n\`\`\``)).toEqual(full);
    expect(parseBrief(`\`\`\`\n${json}\n\`\`\``)).toEqual(full);
    expect(parseBrief(`\`\`\`json ${JSON.stringify(full)}\`\`\``)).toEqual(full);
  });

  it('accepts JSON wrapped in prose, braces in the prose and in strings included', () => {
    const tricky = { ...full, tone: 'dry {sarcastic} "quotes" and \\ backslashes }' };
    expect(parseBrief(`Sure! Here is the brief {as asked}:\n\n${JSON.stringify(tricky)}\n\nLet me know if you need more.`)).toEqual(tricky);
    expect(parseBrief(`Here it is:\n\`\`\`json\n${json}\n\`\`\`\nHope it helps.`)).toEqual(full);
  });

  it('skips an unusable object and takes the next one, and finds one inside an array', () => {
    expect(parseBrief(`{"note": "draft"} then ${json}`)).toEqual(full);
    expect(parseBrief(`[${json}]`)).toEqual(full);
  });

  it('returns undefined for invalid, truncated, empty or non-object answers', () => {
    expect(parseBrief('')).toBeUndefined();
    expect(parseBrief('I cannot help with that.')).toBeUndefined();
    expect(parseBrief(json.slice(0, -20))).toBeUndefined();
    expect(parseBrief("{genre: 'blog', tone: 'dry'}")).toBeUndefined();
    expect(parseBrief('{"genre": "blog",}')).toBeUndefined();
    expect(parseBrief('[1, 2]')).toBeUndefined();
    expect(parseBrief('"genre"')).toBeUndefined();
    expect(parseBrief('{}')).toBeUndefined();
    expect(parseBrief('{"genre": "", "glossary": []}')).toBeUndefined();
  });

  it('keeps partial fields: missing strings are empty, a missing glossary is []', () => {
    expect(parseBrief('{"tone": "sarcastic"}')).toEqual({ genre: '', audience: '', purpose: '', tone: 'sarcastic', glossary: [] });
    expect(parseBrief('{"glossary": [{"term": "pod", "rendering": "Pod"}]}')).toEqual({ genre: '', audience: '', purpose: '', tone: '', glossary: [{ term: 'pod', rendering: 'Pod' }] });
  });

  it('drops wrong-typed fields and malformed or duplicate glossary entries', () => {
    const b = parseBrief(
      JSON.stringify({
        genre: 42,
        audience: ['x'],
        purpose: null,
        tone: '  dry\n\n and   terse ',
        glossary: [{ term: 'a', rendering: 'A' }, { term: 'A', rendering: 'dup' }, { term: 'b' }, 'c', null, { term: '', rendering: 'x' }, { term: 'd', rendering: 'D', note: 7 }],
      }),
    );
    expect(b).toEqual({ genre: '', audience: '', purpose: '', tone: 'dry and terse', glossary: [{ term: 'a', rendering: 'A' }, { term: 'd', rendering: 'D' }] });
    expect(parseBrief('{"tone": "x", "glossary": {"term": "a"}}')?.glossary).toEqual([]);
  });

  it('caps field lengths and the glossary size', () => {
    const b = parseBrief(JSON.stringify({ genre: 'g'.repeat(1000), glossary: Array.from({ length: 50 }, (_, i) => ({ term: `t${i}`, rendering: `r${i}` })) }));
    expect(b?.genre).toHaveLength(BRIEF_FIELD_MAX);
    expect(b?.genre.endsWith('…')).toBe(true);
    expect(b?.glossary).toHaveLength(BRIEF_GLOSSARY_MAX);
  });

  it('keeps a plausible language tag only', () => {
    expect(parseBrief('{"tone": "x", "language": "pt-BR"}')?.language).toBe('pt-BR');
    expect(parseBrief('{"tone": "x", "language": "English"}')?.language).toBeUndefined();
    expect(parseBrief('{"tone": "x", "language": "und"}')?.language).toBeUndefined();
    expect(parseBrief('{"tone": "x", "language": 3}')).not.toHaveProperty('language');
  });
});
