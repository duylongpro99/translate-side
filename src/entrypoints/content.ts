// Content script (plan M0-E3/E4). Injected by the worker with scripting.executeScript under
// activeTab, never declared in the manifest. It answers the panel over a Port and pushes nothing
// on its own: the panel connects and says hello first (decision S5). After `extract`, it pushes
// what is on screen on that port (viewport.ts, plan M3-E1/E7) until the port closes, and the page
// read again whenever it changes (an SPA route change, late content; watch.ts, plan M5-E2), with
// the ids of unchanged blocks kept (stable.ts).
import { browser } from 'wxt/browser';
import { extractPage } from '@/extract';
import { watchViewport, type ViewportWatch } from '@/extract/viewport';
import { watchChanges, type ChangeWatch } from '@/extract/watch';
import { keepIds, readSignature } from '@/segment/stable';
import type { Segment } from '@/engine/types';
import type { InjectOutcome } from '@/shared/inject';
import { CONTENT_PORT_NAME, CONTENT_PORT_PREFIX, PROTOCOL_VERSION, ProtocolError, emit, serve, type ContentApi } from '@/shared/protocol';

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
    // The last read of this document, for stable ids and for telling a real change (plan M5-E2).
    let last: { segments: Segment[]; signature: string; url: string } | undefined;
    /**
     * Reads the page, keeping the ids of blocks that did not change since the last read.
     * `changed`: it differs from the last read. An unreadable read counts as a change only when the
     * address moved (a route change to an empty or mid-render page): the page shown is not this one.
     */
    const read = (targets: Map<string, Element | Range>) => {
      const fresh = new Map<string, Element | Range>();
      const result = extractPage(document, fresh);
      if (!result.ok) {
        const moved = last !== undefined && withoutHash(result.url) !== withoutHash(last.url);
        // Keep the blocks for their ids (the reader may come back); the next good read is a change.
        if (last) last = { ...last, signature: '', url: result.url };
        return { result, changed: moved };
      }
      const renames = keepIds(last?.segments ?? [], result.segments);
      for (const [id, target] of fresh) targets.set(renames.get(id) ?? id, target);
      const signature = readSignature(result.url, result.segments);
      const changed = signature !== last?.signature;
      last = { segments: result.segments, signature, url: result.url };
      return { result, changed };
    };
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== CONTENT_PORT_NAME) {
        // A panel of another version: hang up so it fails fast (it can't speak our messages).
        if (port.name.startsWith(CONTENT_PORT_PREFIX)) port.disconnect();
        return;
      }
      // One watch per connection, over the segments of its latest read.
      let watch: ViewportWatch | undefined;
      // And one change watch: after the first `extract`, the page is read again when it changes.
      let changes: ChangeWatch | undefined;
      port.onDisconnect.addListener(() => {
        watch?.stop();
        changes?.stop();
      });
      const look = (targets: Map<string, Element | Range>, segments: readonly Segment[]) => {
        watch?.stop();
        watch = watchViewport(window, targets, segments.map((s) => s.id), (v) => emit(port, 'viewport', v));
        return watch.now();
      };
      const reread = () => {
        const targets = new Map<string, Element | Range>();
        const { result, changed } = read(targets);
        changes?.reported(changed);
        if (!changed) return;
        // An unreadable moment on the same address (a password field has focus, the content is
        // mid-render) sent nothing above; on a new address the panel must drop the old page.
        if (!result.ok) {
          watch?.stop();
          watch = undefined;
          emit(port, 'changed', result);
          return;
        }
        const { visible, anchor } = look(targets, result.segments);
        emit(port, 'changed', { ...result, visible, ...(anchor ? { anchor } : {}) });
      };
      serve<ContentApi>(port, {
        hello: ({ v }) => {
          if (v !== PROTOCOL_VERSION) {
            throw new ProtocolError('version-mismatch', `Panel speaks v${v}, page speaks v${PROTOCOL_VERSION}.`);
          }
          return { v: PROTOCOL_VERSION, docId, url: location.href };
        },
        extract: () => {
          watch?.stop();
          watch = undefined;
          changes ??= watchChanges(window, reread);
          const targets = new Map<string, Element | Range>();
          const { result } = read(targets);
          if (!result.ok) return result;
          const { visible, anchor } = look(targets, result.segments);
          return { ...result, visible, ...(anchor ? { anchor } : {}) };
        },
      });
    });
    return 'injected';
  },
});

const withoutHash = (url: string) => url.replace(/#.*$/, '');

function isRuntimeAlive(): boolean {
  try {
    return Boolean(browser.runtime.id);
  } catch {
    return false;
  }
}
