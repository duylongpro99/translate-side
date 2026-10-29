// The popup's selection: the content script opens the popup and messages the worker in the same
// click, so the record the worker keeps (src/shared/panel.ts) may land just after the popup loads.
import type { browser } from 'wxt/browser';
import { popupKey, readPopupRecord, type PopupRecord } from '@/shared/snippet';

type Browser = typeof browser;

/** How long the popup waits for the worker's record before it says the selection is gone. */
export const RECORD_WAIT_MS = 5_000;

/** The record kept for popup `id`, as soon as it is there; undefined when none comes within `ms`. */
export function waitForPopupRecord(api: Browser, id: string, ms = RECORD_WAIT_MS): Promise<PopupRecord | undefined> {
  return new Promise((resolve) => {
    const key = popupKey(id);
    let settled = false;
    const done = (record: PopupRecord | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      api.storage.session.onChanged.removeListener(onChanged);
      resolve(record);
    };
    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      const record = changes[key]?.newValue as PopupRecord | undefined;
      if (record) done(record);
    };
    api.storage.session.onChanged.addListener(onChanged);
    const timer = setTimeout(() => done(undefined), ms);
    readPopupRecord(api, id).then(
      (record) => record && done(record),
      () => {},
    );
  });
}
