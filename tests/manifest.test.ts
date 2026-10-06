// Manifest shape per DESIGN.md §8 (minimal permissions) and plan M0-E2.
import { describe, expect, it } from 'vitest';
import config from '../wxt.config.ts';

const manifest = config.manifest as Record<string, unknown> & {
  commands: Record<string, { suggested_key: { default: string } }>;
};

describe('manifest', () => {
  it('requests exactly the minimal permissions', () => {
    expect(manifest.permissions).toEqual(['sidePanel', 'storage', 'activeTab', 'scripting', 'contextMenus']);
  });

  it('has no install-time host permissions or blanket content scripts', () => {
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  });

  it('binds Alt+T to the action, which opens the side panel', () => {
    expect(manifest.commands._execute_action?.suggested_key.default).toBe('Alt+T');
  });

  it('targets Chrome 138+', () => {
    expect(manifest.minimum_chrome_version).toBe('138');
  });
});
