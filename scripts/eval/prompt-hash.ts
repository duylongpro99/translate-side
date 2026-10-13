// Hashes of the system prompts a harness run sends, rendered with no context (English source, the run's
// target, style and gloss setting): a rule changed in place, under the same prompt id, gets a new hash.
// run.ts records them in summary.json; the gate compares them before a finished run may seed a baseline.
import { createHash } from 'node:crypto';
import { createDefaultPromptRegistry, renderSystemPrompt, renderSystemPromptV2, TRANSLATE_PROMPT_ID, type GlossMode, type StyleMode } from '@/engine/index';

export interface PromptHashVars {
  targetLang: string;
  style: StyleMode;
  gloss: GlossMode;
}

/** 12 hex digits of SHA-256. */
const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** The translate prompt `id` (translate@1 renders without the gloss setting). Throws on an unknown id. */
export function translatePromptHash(id: string, vars: PromptHashVars, registry = createDefaultPromptRegistry()): string {
  const render = registry.get(id).render;
  const system = id === TRANSLATE_PROMPT_ID ? renderSystemPrompt(render, { sourceLang: 'en', targetLang: vars.targetLang, style: vars.style }) : renderSystemPromptV2(render, { sourceLang: 'en', targetLang: vars.targetLang, style: vars.style, gloss: vars.gloss, snippets: [] });
  return hash(system);
}

/** The review prompt `id`, rendered as the review stage renders it. Throws on an unknown id. */
export function reviewPromptHash(id: string, vars: PromptHashVars, registry = createDefaultPromptRegistry()): string {
  const prompt = registry.get(id);
  return hash(renderSystemPromptV2((v) => prompt.render(v), { sourceLang: 'en', targetLang: vars.targetLang, style: vars.style, gloss: vars.gloss, snippets: [] }));
}
