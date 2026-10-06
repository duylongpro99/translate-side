// Proves the type layer of the engine boundary: under src/engine/tsconfig.json there are no
// DOM or chrome types, so engine code that names them fails to typecheck.
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = path.resolve('src/engine');
const PROBE = path.join(ENGINE_DIR, '__boundary_probe__.ts');

function diagnosticsFor(source: string): string[] {
  const configPath = path.join(ENGINE_DIR, 'tsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error('could not parse engine tsconfig');
  const host = ts.createCompilerHost(parsed.options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (f) => f === PROBE || fileExists.call(host, f);
  host.readFile = (f) => (f === PROBE ? source : readFile.call(host, f));
  host.getSourceFile = (f, lang, ...rest) =>
    f === PROBE ? ts.createSourceFile(f, source, lang) : getSourceFile.call(host, f, lang, ...rest);
  const program = ts.createProgram([...parsed.fileNames, PROBE], parsed.options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('engine/ boundary (TypeScript)', () => {
  it.each([
    ['HTMLElement type', `export function f(el: HTMLElement) { return el; }`, /HTMLElement/],
    ['document', `export const t = document.title;`, /document/],
    ['chrome namespace', `export const id: string = chrome.runtime.id;`, /chrome/],
    ['DOM Node type', `export type N = Node;`, /Node/],
  ])('rejects %s', (_name, source, pattern) => {
    const errors = diagnosticsFor(source);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(pattern);
  });

  // N1: the repo uses .ts specifiers; value imports must typecheck under the engine config.
  it('accepts value imports with .ts specifiers', () => {
    const source = `import { createEngine } from './index.ts';\nexport const d = createEngine;`;
    expect(diagnosticsFor(source)).toEqual([]);
  });

  it('accepts plain TypeScript using the LLMClient interface', () => {
    const source = [
      `import type { LLMClient } from '../llm/types.ts';`,
      `export const roles = (c: LLMClient): string[] => [typeof c, new Date(0).toISOString()];`,
    ].join('\n');
    expect(diagnosticsFor(source)).toEqual([]);
  });
});
