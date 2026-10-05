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
  'no-restricted-syntax',
  'no-new-func',
  'no-eval',
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
  // B1: dynamic import() and require() are not seen by no-restricted-imports.
  ['dynamic import of wxt', `export const m = async () => (await import('wxt/browser')).browser.runtime.id;`, 'no-restricted-syntax'],
  ['dynamic import of llm implementation', `export const m = () => import('../llm/anthropic.ts');`, 'no-restricted-syntax'],
  ['dynamic import of llm/types', `export const m = () => import('../../llm/types.ts');`, 'no-restricted-syntax'],
  ['require()', `export const m = require('wxt/browser');`, 'no-restricted-syntax'],
  // B2: barrel paths with no segment after llm/.
  ['llm barrel (relative)', `import { x } from '../llm';\nexport const c = x;`, 'no-restricted-imports'],
  ['llm barrel (alias)', `import { x } from '@/llm';\nexport const c = x;`, 'no-restricted-imports'],
  ['llm barrel (tilde alias)', `import { x } from '~/llm';\nexport const c = x;`, 'no-restricted-imports'],
  ['llm barrel re-export', `export * from '../../llm';`, 'no-restricted-imports'],
  // N3: extension/DOM globals reached through the global object (now banned outright).
  ['globalThis.chrome', `export const id = globalThis.chrome.runtime.id;`, 'no-restricted-globals'],
  ['(globalThis as any).chrome', `export const id = (globalThis as any).chrome.runtime.id;`, 'no-restricted-globals'],
  ['(globalThis as any)["chrome"]', `export const id = (globalThis as any)['chrome'].runtime.id;`, 'no-restricted-globals'],
  // Tester round 1: more bypasses.
  ['typeof import() type', `export type B = typeof import('wxt/browser');`, 'no-restricted-syntax'],
  ['import() type of llm implementation', `export type C = import('../llm/openai.ts').OpenAIChat;`, 'no-restricted-syntax'],
  ['require() with a declared require', `declare function require(id: string): unknown;\nexport const m = require('wxt/browser');`, 'no-restricted-syntax'],
  ['import = require()', `import b = require('wxt/browser');\nexport const m = b;`, 'no-restricted-syntax'],
  ['double cast of globalThis', `export const c = (globalThis as unknown as { chrome: unknown }).chrome;`, 'no-restricted-globals'],
  ['computed globalThis access', `const k = 'doc' + 'ument';\nexport const d = (globalThis as Record<string, unknown>)[k];`, 'no-restricted-globals'],
  ['globalThis destructuring', `const { chrome: c } = globalThis;\nexport const id = c;`, 'no-restricted-globals'],
  ['globalThis alias', `const g = globalThis;\nexport const d = g.document;`, 'no-restricted-globals'],
  ['new Function escape', `export const g = new Function('return this')();`, 'no-new-func'],
  ['eval escape', `export const g = eval('this');`, 'no-eval'],
  ['self.browser', `export const id = self.browser.runtime.id;`, 'no-restricted-globals'],
  ['globalThis["document"]', `export const d = globalThis['document'];`, 'no-restricted-globals'],
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

// N4: engine/ may import llm/types.ts, so that file must not import anything itself, or it
// becomes a transitive hole in the boundary.
describe('llm/types.ts stays import-free', () => {
  it.each([
    ['type import from wxt', `import type { Browser } from 'wxt/browser';\nexport type B = Browser;`],
    ['llm implementation', `import { AnthropicClient } from './anthropic.ts';\nexport const c = AnthropicClient;`],
    ['re-export', `export * from './anthropic.ts';`],
    ['named re-export', `export { AnthropicClient } from './anthropic.ts';`],
    ['dynamic import', `export const m = () => import('./anthropic.ts');`],
  ])('rejects %s', async (_name, code) => {
    expect(await boundaryErrors(code, 'src/llm/types.ts')).not.toEqual([]);
  });

  it('the real src/llm/types.ts is clean', async () => {
    const [result] = await eslint.lintFiles(['src/llm/types.ts']);
    expect(result?.messages).toEqual([]);
  });
});
