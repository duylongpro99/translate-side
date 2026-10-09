// Auto-detect against a live gateway (plan M4 §3 #1, M4-F): the Settings' Test connection (src/shared/connect.ts
// testConnection) with protocol `auto` and the preset's base URL. Key from .env, never printed.
// Run: pnpm run eval:detect -- [--preset openrouter] [--model id] (the key variable is the one the harness names for the preset)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createAdapter } from '@/llm/client';
import { testConnection } from '@/shared/connect';
import { PRESETS } from '@/shared/presets';

const { values: opt } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { preset: { type: 'string', default: 'openrouter' }, model: { type: 'string' }, key: { type: 'string', default: 'OPENROUTER_API_KEY' } } });
if (fs.existsSync(path.join(process.cwd(), '.env'))) process.loadEnvFile(path.join(process.cwd(), '.env'));
const preset = PRESETS.find((p) => p.id === opt.preset);
if (!preset) throw new Error(`unknown preset ${opt.preset as string}`);
const apiKey = process.env[opt.key as string];
if (!apiKey) throw new Error(`${opt.key as string} is not set`);
const r = await testConnection(
  { preset, protocol: 'auto', baseUrl: preset.baseUrl, auth: { style: preset.auth }, apiKey, quirks: preset.quirks, ...(opt.model ? { model: opt.model } : {}) },
  { adapter: createAdapter, hasHostPermission: async () => true },
);
const checks = r.checks.map((c) => ({ protocol: c.protocol, baseUrl: c.baseUrl, auth: c.auth.style, models: c.models?.length ?? null, chatModel: c.chatModel ?? null, error: c.error ? `${c.error.kind}: ${c.error.message}` : null }));
console.log(JSON.stringify(r.ok ? { ok: true, protocol: r.protocol, detected: r.detected, baseUrl: r.baseUrl, auth: r.auth.style, authByProtocol: r.authByProtocol ?? null, checks } : { ok: false, error: `${r.error.kind}: ${r.error.message}`, checks }, null, 1));
