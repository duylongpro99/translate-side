// The parts of the real engine the S8 Nano harness needs, bundled by ../build.mjs into ext/engine.js
// (an IIFE that sets `globalThis.S8Engine`). Nothing is copied: the prompt, the wire format, the
// segment-marker parser and the repair plan are the ones the single-pass strategy uses
// (src/engine/strategies/single-pass.ts prepareChunk/translateRequest), so a parse failure here is
// one the product would see.
import { renderSystemPromptV2, DEFAULT_GLOSS } from '../../../src/engine/context/assemble.ts';
import { translateV2, TRANSLATE_V2_PROMPT_ID } from '../../../src/engine/prompts/translate.ts';
import { formatWire, toWire } from '../../../src/engine/parsing/wire.ts';
import { parseOutput } from '../../../src/engine/parsing/seg-parser.ts';
import { planRepair } from '../../../src/engine/parsing/repair.ts';
import { estimateTokens } from '../../../src/engine/tokens.ts';
import { maxOutputTokens } from '../../../src/engine/budget.ts';
import { TRANSLATE_TEMPERATURE } from '../../../src/engine/strategies/single-pass.ts';
import type { Segment } from '../../../src/engine/types.ts';

export { estimateTokens, formatWire, maxOutputTokens, parseOutput, planRepair, toWire, TRANSLATE_TEMPERATURE, TRANSLATE_V2_PROMPT_ID };

/**
 * The single-pass system block for a document with no brief and no glossary yet (snippets: none),
 * style Natural, the default gloss mode: what the first chunk of a page is sent today.
 */
export function systemPrompt(sourceLang: string, targetLang: string): string {
  return renderSystemPromptV2((vars) => translateV2.render(vars), { sourceLang, targetLang, style: 'natural', gloss: DEFAULT_GLOSS, snippets: [] });
}

// The two output rules of translate@2 that name the `<seg>` markers. The JSON variant swaps exactly these.
const MARKER_RULES = [
  `- Output each segment as <seg id="N">…</seg> with the same ids, in the same order.
  Output nothing else: no preamble, no notes, no code fences.`,
  `- Copy each opening tag exactly as given, with all its attributes. If a tag is
  <seg id="N" n="XXXX">, output <seg id="N" n="XXXX"> with the same n value.`,
] as const;

/**
 * The same system block with the marker output rules replaced by a JSON-array rule (for
 * `responseConstraint`). Throws if the prompt no longer holds the marker rules, so the variant
 * cannot silently drift from the real prompt.
 */
export function systemPromptJson(sourceLang: string, targetLang: string): string {
  let text = systemPrompt(sourceLang, targetLang);
  for (const rule of MARKER_RULES) {
    if (!text.includes(rule)) throw new Error('translate@2 no longer holds the marker output rule this spike replaces');
  }
  text = text.replace(
    MARKER_RULES[0],
    `- Output a JSON array of strings: one string per segment, the translation of segment 1
  first, then segment 2, and so on, as many strings as there are segments.
  Output nothing else: no preamble, no notes, no code fences.`,
  );
  return text.replace(`${MARKER_RULES[1]}\n`, '');
}

/** A harness block as a Segment (only what the wire format and parser read). */
export function asSegment(b: { id: string; kind: string; inlineMarkup: string }): Segment {
  return { id: b.id, kind: b.kind, text: b.inlineMarkup, inlineMarkup: b.inlineMarkup, domPath: '', translate: true } as Segment;
}
