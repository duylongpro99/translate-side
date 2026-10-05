// Proves the engine/ import boundary (DESIGN.md §5.1) is enforced by ESLint: forbidden code
// fails when it sits in src/engine/, passes when it sits in the shell, and clean engine code
// passes.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const BOUNDARY_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-globals',
  '@typescript-eslint/triple-slash-reference',
]);

async function boundaryErrors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null && BOUNDARY_RULES.has(m.ruleId))
    .map((m) => m.ruleId as string);
}

const ENGINE_FILE = 'src/engine/strategies/probe.ts';
const SHELL_FILE = 'src/entrypoints/probe.ts';

const violations: [string, string, string][] = [
  ['wxt/browser import', `import { browser } from 'wxt/browser';\nexport const b = browser;`, 'no-restricted-imports'],
  ['bare wxt import', `import { defineConfig } from 'wxt';\nexport const d = defineConfig;`, 'no-restricted-imports'],
  ['@wxt-dev package', `import { storage } from '@wxt-dev/storage';\nexport const s = storage;`, 'no-restricted-imports'],
  ['#imports alias', `import { browser } from '#imports';\nexport const b = browser;`, 'no-restricted-imports'],
  ['chrome global', `export const id = chrome.runtime.id;`, 'no-restricted-globals'],
  ['browser global', `export const id = browser.runtime.id;`, 'no-restricted-globals'],
  ['document global', `export const t = document.title;`, 'no-restricted-globals'],
  ['window global', `export const w = window.innerWidth;`, 'no-restricted-globals'],
  ['chrome types reference', `/// <reference types="chrome" />\nexport const x = 1;`, '@typescript-eslint/triple-slash-reference'],
  ['dom lib reference', `/// <reference lib="dom" />\nexport const x = 1;`, '@typescript-eslint/triple-slash-reference'],
  ['llm implementation (relative)', `import { AnthropicClient } from '../../llm/anthropic-messages';\nexport const c = AnthropicClient;`, 'no-restricted-imports'],
  ['llm implementation (alias)', `import { OpenAIChat } from '@/llm/openai-chat.ts';\nexport const c = OpenAIChat;`, 'no-restricted-imports'],
  ['llm nested implementation', `import { x } from '../../llm/adapters/builtin.ts';\nexport const c = x;`, 'no-restricted-imports'],
  ['shell module', `import { setupPanelBehavior } from '../../shared/panel.ts';\nexport const s = setupPanelBehavior;`, 'no-restricted-imports'],
];

describe('engine/ boundary (ESLint)', () => {
  it.each(violations)('rejects %s in engine/', async (_name, code, rule) => {
    expect(await boundaryErrors(code, ENGINE_FILE)).toContain(rule);
  });

  it.each(violations)('allows %s outside engine/', async (_name, code) => {
    expect(await boundaryErrors(code, SHELL_FILE)).toEqual([]);
  });

  it('accepts clean engine code that uses only the LLMClient interface', async () => {
    const clean = [
      `import type { LLMClient } from '../../llm/types.ts';`,
      `import type { ModelRole } from '@/llm/types';`,
      `export async function run(llm: LLMClient, role: ModelRole, signal: AbortSignal) {`,
      `  const out: string[] = [];`,
      `  for await (const ev of llm.stream({ role, system: '', messages: [], maxTokens: 1 }, signal)) {`,
      `    if (ev.type === 'text') out.push(ev.text);`,
      `  }`,
      `  return out.join('');`,
      `}`,
    ].join('\n');
    const [result] = await eslint.lintText(clean, { filePath: ENGINE_FILE });
    expect(result?.messages).toEqual([]);
  });

  it('the real src/engine tree is clean', async () => {
    const results = await eslint.lintFiles(['src/engine']);
    expect(results.length).toBeGreaterThan(0);
    expect(results.flatMap((r) => r.messages)).toEqual([]);
  });
});
