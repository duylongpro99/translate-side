// Prompt registry (DESIGN.md §5.5): prompts are versioned assets with ids like `translate@1`.

import type { PromptRegistry, PromptTemplate } from '../types.ts';

const SLOT = /\{([A-Z][A-Z0-9_]*)\}/g;

/** A template whose `{NAME}` slots are filled by `render`. */
export function definePrompt(name: string, version: number, template: string): PromptTemplate {
  return {
    id: `${name}@${version}`,
    name,
    version,
    render(vars) {
      return template.replace(SLOT, (_, slot: string) => {
        const value = vars[slot];
        if (value === undefined) throw new Error(`prompt ${name}@${version}: no value for {${slot}}`);
        return value;
      });
    },
  };
}

export function createPromptRegistry(templates: readonly PromptTemplate[]): PromptRegistry {
  const byId = new Map<string, PromptTemplate>();
  for (const t of templates) {
    if (t.id !== `${t.name}@${t.version}`) throw new Error(`prompt id ${t.id} must be ${t.name}@${t.version}`);
    if (byId.has(t.id)) throw new Error(`duplicate prompt ${t.id}`);
    byId.set(t.id, t);
  }
  return {
    get(id) {
      const t = byId.get(id);
      if (t === undefined) throw new Error(`unknown prompt ${id}`);
      return t;
    },
    has: (id) => byId.has(id),
    latest(name) {
      let best: PromptTemplate | undefined;
      for (const t of byId.values()) if (t.name === name && (best === undefined || t.version > best.version)) best = t;
      return best;
    },
  };
}
