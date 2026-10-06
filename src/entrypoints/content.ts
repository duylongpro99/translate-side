// Content script (plan M0-E3/E4). Injected by the worker with scripting.executeScript under
// activeTab, never declared in the manifest. It answers the panel over a Port and pushes nothing
// on its own: the panel connects and says hello first (decision S5).
import { browser } from 'wxt/browser';
import { extractPage } from '@/extract';
import type { InjectOutcome } from '@/shared/inject';
import { CONTENT_PORT_NAME, PROTOCOL_VERSION, ProtocolError, serve, type ContentApi } from '@/shared/protocol';

declare global {
  // Set by the first injection into this page's isolated world.
  var __translateSide: { alive(): boolean } | undefined;
}

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  // The return value is what scripting.executeScript reports to the worker.
  main(): InjectOutcome {
    // Injection is idempotent: reloads, hash and pushState changes, and repeated clicks inject again.
    // A copy left over from a reloaded extension is dead (its runtime is gone), so replace it.
    if (globalThis.__translateSide?.alive()) return 'already';
    globalThis.__translateSide = { alive: isRuntimeAlive };

    const docId = crypto.randomUUID();
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== CONTENT_PORT_NAME) return;
      serve<ContentApi>(port, {
        hello: ({ v }) => {
          if (v !== PROTOCOL_VERSION) {
            throw new ProtocolError('version-mismatch', `Panel speaks v${v}, page speaks v${PROTOCOL_VERSION}.`);
          }
          return { v: PROTOCOL_VERSION, docId, url: location.href };
        },
        extract: () => extractPage(document),
      });
    });
    return 'injected';
  },
});

function isRuntimeAlive(): boolean {
  try {
    return Boolean(browser.runtime.id);
  } catch {
    return false;
  }
}
