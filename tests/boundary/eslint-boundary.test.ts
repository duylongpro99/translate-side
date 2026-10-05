// Proves layer 1 of the engine/ boundary (DESIGN.md §5.1, eslint.config.js): forbidden code
// fails when it sits in src/engine/, passes when it sits in the shell, and clean engine code
// passes. Layer 2 (resolver closure) is proven in closure.test.ts, layer 3 in tsc-boundary.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const BOUNDARY_RULES = new Set([
  'boundary/engine-imports',
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
  ['wxt/browser import', `import { browser } from 'wxt/browser';\nexport const b = browser;`, 'boundary/engine-imports'],
  ['bare wxt import', `import { defineConfig } from 'wxt';\nexport const d = defineConfig;`, 'boundary/engine-imports'],
  ['@wxt-dev package', `import { storage } from '@wxt-dev/storage';\nexport const s = storage;`, 'boundary/engine-imports'],
  ['#imports alias', `import { browser } from '#imports';\nexport const b = browser;`, 'boundary/engine-imports'],
  ['chrome global', `export const id = chrome.runtime.id;`, 'no-restricted-globals'],
  ['browser global', `export const id = browser.runtime.id;`, 'no-restricted-globals'],
  ['document global', `export const t = document.title;`, 'no-restricted-globals'],
  ['window global', `export const w = window.innerWidth;`, 'no-restricted-globals'],
  ['chrome types reference', `/// <reference types="chrome" />\nexport const x = 1;`, '@typescript-eslint/triple-slash-reference'],
  ['dom lib reference', `/// <reference lib="dom" />\nexport const x = 1;`, '@typescript-eslint/triple-slash-reference'],
  ['llm implementation (relative)', `import { AnthropicClient } from '../../llm/anthropic-messages';\nexport const c = AnthropicClient;`, 'boundary/engine-imports'],
  ['llm implementation (alias)', `import { OpenAIChat } from '@/llm/openai-chat.ts';\nexport const c = OpenAIChat;`, 'boundary/engine-imports'],
  ['llm nested implementation', `import { x } from '../../llm/adapters/builtin.ts';\nexport const c = x;`, 'boundary/engine-imports'],
  // B1: dynamic import() and require() are not seen by no-restricted-imports.
  ['dynamic import of wxt', `export const m = async () => (await import('wxt/browser')).browser.runtime.id;`, 'no-restricted-syntax'],
  ['dynamic import of llm implementation', `export const m = () => import('../llm/anthropic.ts');`, 'no-restricted-syntax'],
  ['dynamic import of llm/types', `export const m = () => import('../../llm/types.ts');`, 'no-restricted-syntax'],
  ['require()', `export const m = require('wxt/browser');`, 'no-restricted-syntax'],
  // B2: barrel paths with no segment after llm/.
  ['llm barrel (relative)', `import { x } from '../../llm';\nexport const c = x;`, 'boundary/engine-imports'],
  ['llm barrel (alias)', `import { x } from '@/llm';\nexport const c = x;`, 'boundary/engine-imports'],
  ['llm barrel (tilde alias)', `import { x } from '~/llm';\nexport const c = x;`, 'boundary/engine-imports'],
  ['llm barrel re-export', `export * from '../../llm';`, 'boundary/engine-imports'],
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
  // Tester round 2 (a): allowlist, so any folder outside engine/ is a forbidden relay.
  ['relay through another src/ folder', `import { browser } from '../../lib/reexport';\nexport const b = browser;`, 'boundary/engine-imports'],
  ['relay re-export', `export { browser } from '../../lib/reexport.ts';`, 'boundary/engine-imports'],
  ['relay via @/ alias', `import { x } from '@/lib/reexport';\nexport const c = x;`, 'boundary/engine-imports'],
  ['relay via ~~/ alias', `import { x } from '~~/src/lib/reexport';\nexport const c = x;`, 'boundary/engine-imports'],
  ['path that leaves and re-enters', `import { x } from '../../engine/../lib/x';\nexport const c = x;`, 'boundary/engine-imports'],
  ['absolute path', `import { x } from '/etc/x';\nexport const c = x;`, 'boundary/engine-imports'],
  ['node builtin', `import fs from 'node:fs';\nexport const f = fs;`, 'boundary/engine-imports'],
  ['vitest from engine source', `import { it } from 'vitest';\nexport const t = it;`, 'boundary/engine-imports'],
  ['Vite ?raw suffix', `import src from './index.ts?raw';\nexport const s = src;`, 'boundary/engine-imports'],
  ['type-only import of a package', `import type { Browser } from 'wxt/browser';\nexport type B = Browser;`, 'boundary/engine-imports'],
  // Tester round 2 (c): import.meta.
  ['import.meta.glob cast', `export const m = (import.meta as unknown as { glob(p: string, o: object): object }).glob('../llm/*.ts', { eager: true });`, 'no-restricted-syntax'],
  ['import.meta.resolve', `export const r = import.meta.resolve('wxt/browser');`, 'no-restricted-syntax'],
  ['import.meta.env', `export const e = (import.meta as unknown as { env: object }).env;`, 'no-restricted-syntax'],
  // Tester round 2 (d): Function constructor without the name.
  ['arrow .constructor', `export const g = (() => {}).constructor('return this')();`, 'no-restricted-syntax'],
  ['[].constructor.constructor', `export const g = [].constructor.constructor('return this')();`, 'no-restricted-syntax'],
  ['computed ["constructor"]', `export const g = (() => {})['constructor']('return this')();`, 'no-restricted-syntax'],
  ['destructured constructor', `const { constructor: F } = () => {};\nexport const g = F;`, 'no-restricted-syntax'],
  ['Function.prototype.constructor', `export const g = Function.prototype.constructor('return this')();`, 'no-restricted-globals'],
  ['Reflect.construct(Function)', `export const g = Reflect.construct(Function, ['return this'])();`, 'no-restricted-globals'],
  ['Reflect.apply(Function)', `export const g = Reflect.apply(Function, null, ['return this'])();`, 'no-restricted-globals'],
  ['AsyncFunction constructor', `export const g = Object.getPrototypeOf(async () => {}).constructor;`, 'no-restricted-syntax'],
  ['__proto__ walk', `export const g = (() => {}).__proto__;`, 'no-restricted-syntax'],
  ['property descriptor walk', `export const g = Object.getOwnPropertyDescriptor(Object.prototype, 'x');`, 'no-restricted-syntax'],
  // Tester round 2 minor: require aliases.
  ['require alias', `declare const require: (id: string) => unknown;\nconst r = require;\nexport const m = r('wxt/browser');`, 'no-restricted-syntax'],
  ['require.call', `declare const require: { call(t: null, id: string): unknown };\nexport const m = require.call(null, 'wxt/browser');`, 'no-restricted-syntax'],
  // Own red-team: runtime loading and network globals.
  ['importScripts', `importScripts('https://x.test/a.js');`, 'no-restricted-globals'],
  ['fetch', `export const r = fetch('https://x.test');`, 'no-restricted-globals'],
  // Own red-team: ambient declarations hide globals from no-restricted-globals.
  ['declare const chrome', `declare const chrome: any;\nexport const id = chrome.runtime.id;`, 'no-restricted-syntax'],
  ['declare function importScripts', `declare function importScripts(u: string): void;\nimportScripts('x');`, 'no-restricted-syntax'],
  ['declare global', `declare global { var chrome: any }\nexport const id = 1;`, 'no-restricted-syntax'],
  ['declare module', `declare module 'wxt/browser' { export const b: unknown }\nexport const x = 1;`, 'no-restricted-syntax'],
  ['declare class', `declare class Document { title: string }\nexport const x = 1;`, 'no-restricted-syntax'],
  ['escaped globalThis identifier', `export const g = glob\\u0061lThis;`, 'no-restricted-globals'],
  ['self.browser', `export const id = self.browser.runtime.id;`, 'no-restricted-globals'],
  ['globalThis["document"]', `export const d = globalThis['document'];`, 'no-restricted-globals'],
  ['shell module', `import { setupPanelBehavior } from '../../shared/panel.ts';\nexport const s = setupPanelBehavior;`, 'boundary/engine-imports'],
];

describe('engine/ boundary (ESLint)', () => {
  it.each(violations)('rejects %s in engine/', async (_name, code, rule) => {
    expect(await boundaryErrors(code, ENGINE_FILE)).toContain(rule);
  });

  it.each(violations)('allows %s outside engine/', async (_name, code) => {
    expect(await boundaryErrors(code, SHELL_FILE)).toEqual([]);
  });

  // Tester round 2 (b): every script extension in engine/ gets the rules.
  it.each(['leak.mts', 'leak.cts', 'leak.js', 'leak.mjs', 'leak.cjs', 'leak.tsx', 'leak.jsx'])(
    'applies the boundary to src/engine/%s',
    async (name) => {
      const code = `export { browser } from 'wxt/browser';`;
      expect(await boundaryErrors(code, `src/engine/${name}`)).toContain('boundary/engine-imports');
    },
  );

  it.each([
    ['sibling file', `import { a } from './util.ts';\nexport const b = a;`],
    ['parent engine file', `import { describeEngine } from '../index.ts';\nexport const d = describeEngine;`],
    ['engine directory index', `import { describeEngine } from '..';\nexport const d = describeEngine;`],
    ['interface via relative path', `import type { LLMClient } from '../../llm/types.ts';\nexport type C = LLMClient;`],
    ['interface without extension', `import type { LLMClient } from '../../llm/types';\nexport type C = LLMClient;`],
    ['interface via @/ alias', `import type { LLMClient } from '@/llm/types';\nexport type C = LLMClient;`],
  ])('allows %s', async (_name, code) => {
    expect(await boundaryErrors(code, ENGINE_FILE)).toEqual([]);
  });

  it('allows engine tests to import vitest, and nothing else outside engine/', async () => {
    const file = 'src/engine/strategies/probe.test.ts';
    expect(await boundaryErrors(`import { it } from 'vitest';\nexport const t = it;`, file)).toEqual([]);
    expect(await boundaryErrors(`import { browser } from 'wxt/browser';\nexport const b = browser;`, file)).toContain(
      'boundary/engine-imports',
    );
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

// N-new1: an inline eslint-disable must not switch the boundary off in engine source.
// Engine test files keep inline config (src/engine/index.test.ts uses it on purpose).
describe('inline config cannot disable the engine boundary', () => {
  const forbidden = `import { browser } from 'wxt/browser';\nexport const b = browser;`;
  it.each([
    ['eslint-disable-next-line', `// eslint-disable-next-line boundary/engine-imports\n${forbidden}`],
    ['file-wide eslint-disable', `/* eslint-disable */\n${forbidden}`],
    ['eslint rule override', `/* eslint boundary/engine-imports: "off" */\n${forbidden}`],
  ])('ignores %s in engine source', async (_name, code) => {
    expect(await boundaryErrors(code, ENGINE_FILE)).toContain('boundary/engine-imports');
  });

  it('still honours inline disables in engine test files', async () => {
    const code = `// eslint-disable-next-line boundary/engine-imports\n${forbidden}`;
    expect(await boundaryErrors(code, 'src/engine/strategies/probe.test.ts')).toEqual([]);
  });
});
