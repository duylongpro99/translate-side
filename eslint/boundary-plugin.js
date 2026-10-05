// ESLint rule `boundary/engine-imports`: an ALLOWLIST for module specifiers in src/engine/**
// (DESIGN.md §5.1). A module there may import only:
//   - relative paths that resolve inside src/engine/ (after following symlinks);
//   - the LLM interface file, src/llm/types.ts (relative, or via `@/llm/types`, `~/llm/types`);
//   - bare packages named in `allowedPackages` (empty for engine source).
// Everything else fails: other src/ folders, aliases, node: builtins, URLs, Vite `?query`
// suffixes. The same resolution is re-checked with TypeScript's resolver over the whole
// engine program by scripts/check-engine-boundary.mjs.
import fs from 'node:fs';
import path from 'node:path';

const INTERFACE_ALIASES = ['@/llm/types', '@/llm/types.ts', '~/llm/types', '~/llm/types.ts'];
const STRIP_EXT = /\.(ts|js|mts|mjs|cts|cjs|tsx|jsx)$/;

function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isInside(dir, p) {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Existing files a relative specifier could resolve to (for the symlink check). */
function candidates(resolved) {
  const base = resolved.replace(STRIP_EXT, '');
  return [resolved, `${base}.ts`, `${base}.d.ts`, path.join(resolved, 'index.ts')].filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

export function checkSpecifier(spec, { filename, root, allowedPackages = [] }) {
  const engineDir = path.join(root, 'src/engine');
  const interfaceFile = path.join(root, 'src/llm/types.ts');
  if (/[?#]/.test(spec)) return 'query or hash suffixes (Vite `?raw`, `?worker`, …) are not allowed';
  if (INTERFACE_ALIASES.includes(spec)) return null;
  if (!spec.startsWith('.')) {
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    return allowedPackages.includes(pkg) ? null : `'${spec}' is not an allowed package or path`;
  }
  const resolved = path.resolve(path.dirname(filename), spec);
  if (resolved.replace(STRIP_EXT, '') === interfaceFile.replace(STRIP_EXT, '')) return null;
  if (!isInside(engineDir, resolved)) return `'${spec}' resolves outside src/engine/`;
  const realEngine = realpathOrSelf(engineDir);
  for (const file of candidates(resolved)) {
    const real = realpathOrSelf(file);
    if (!isInside(realEngine, real) && real !== realpathOrSelf(interfaceFile)) {
      return `'${spec}' is a symlink to a file outside src/engine/`;
    }
  }
  return null;
}

const engineImports = {
  meta: {
    type: 'problem',
    docs: { description: 'Allowlist of modules that src/engine/ may import (DESIGN.md §5.1).' },
    schema: [
      {
        type: 'object',
        properties: {
          root: { type: 'string' },
          allowedPackages: { type: 'array', items: { type: 'string' } },
        },
        required: ['root'],
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden:
        'engine/ may import only files inside src/engine/ and src/llm/types.ts (DESIGN.md §5.1): {{reason}}.',
    },
  },
  create(context) {
    const options = { ...context.options[0], filename: context.filename };
    const check = (node) => {
      if (!node || node.type !== 'Literal' || typeof node.value !== 'string') return;
      const reason = checkSpecifier(node.value, options);
      if (reason) context.report({ node, messageId: 'forbidden', data: { reason } });
    };
    return {
      ImportDeclaration: (n) => check(n.source),
      ExportNamedDeclaration: (n) => check(n.source),
      ExportAllDeclaration: (n) => check(n.source),
      // Banned outright elsewhere, but check their sources too, so the allowlist stands alone.
      ImportExpression: (n) => check(n.source),
      TSExternalModuleReference: (n) => check(n.expression),
      TSImportType: (n) => check(n.argument?.type === 'TSLiteralType' ? n.argument.literal : n.argument),
    };
  },
};

export default { rules: { 'engine-imports': engineImports } };
