// Prompt assembly for `translate@2` (DESIGN.md §5.7, plan M2-E3). Byte-stable: the system block is
// built only from what is the same for every chunk of a document once the brief is known
// (languages, style mode, gloss rule, and the providers' document-scoped snippets: brief and
// glossary), so every briefed chunk of a document sends the very same system block, the
// prompt-caching prefix. Chunk-scoped snippets (the context tail, the terms already used) go in
// the user message, in one `<context>` block before the segments.
import { GLOSS_RULES, STYLE_LABELS, STYLE_RULES, languageLabel } from '../prompts/translate.ts';
import type { ContextSnippet, GlossMode, StyleMode } from '../types.ts';

export const DEFAULT_GLOSS: GlossMode = 'first';

/** The provider ids whose document snippets fill translate@2's BRIEF and GLOSSARY slots. */
export const BRIEF_PROVIDER_ID = 'brief';
export const GLOSSARY_PROVIDER_ID = 'glossary';

export interface SystemPromptV2Vars {
  sourceLang: string;
  targetLang: string;
  style: StyleMode;
  gloss: GlossMode;
  /** The providers' snippets for this chunk; only the document-scoped ones are used here. */
  snippets: readonly ContextSnippet[];
}

const NONE = '(none)';

/** The `translate@2` system block. Document snippets of other providers follow the glossary, in provider order. */
export function renderSystemPromptV2(render: (vars: Readonly<Record<string, string>>) => string, vars: SystemPromptV2Vars): string {
  const target = languageLabel(vars.targetLang);
  const doc = vars.snippets.filter((s) => s.scope === 'document');
  const join = (id: string) => doc.filter((s) => s.providerId === id).map((s) => s.text).join('\n') || NONE;
  const system = render({
    TARGET_LANG: target,
    SOURCE_LANG: languageLabel(vars.sourceLang),
    STYLE: STYLE_LABELS[vars.style],
    STYLE_RULE: STYLE_RULES[vars.style].replaceAll('{TARGET_LANG}', target),
    GLOSS_RULE: GLOSS_RULES[vars.gloss].replaceAll('{TARGET_LANG}', target),
    BRIEF: join(BRIEF_PROVIDER_ID),
    GLOSSARY: join(GLOSSARY_PROVIDER_ID),
  });
  const extra = doc.filter((s) => s.providerId !== BRIEF_PROVIDER_ID && s.providerId !== GLOSSARY_PROVIDER_ID).map((s) => s.text);
  return extra.length ? `${system}\n\n${extra.join('\n\n')}` : system;
}

/** The user message's `<context>` block from the chunk-scoped snippets; "" when there are none. */
export function renderContextBlock(snippets: readonly ContextSnippet[]): string {
  const parts = snippets.filter((s) => s.scope === 'chunk').map((s) => s.text);
  if (parts.length === 0) return '';
  return ['<context>', 'Context only: do not translate this block and do not output it.', '', parts.join('\n\n'), '</context>'].join('\n');
}

/** Tags of the context block and the wire; page text inside the block must not open or close them (§8). */
const CONTEXT_TAG = /<(\s*\/?\s*)(context|source|translation|seg)(?=[\s>/]|$)/gi;

/** Page text with every context or `<seg>` tag neutralised ("<" → "‹", as analyze@1 does). */
export function neutralizeContextTags(text: string): string {
  return text.replace(CONTEXT_TAG, '‹$1$2');
}
