// State hooks the panel and the selection popup share: a tab's job, its selection and the
// privacy notice, each kept in step with its store.
import { useEffect, useState } from 'preact/hooks';
import type { Jobs, JobView } from './jobs.ts';
import type { PrivacyGate, PrivacyState } from './privacy.ts';
import type { SnippetStore, SnippetView } from './snippet.ts';

const nextFrame = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

/**
 * The active tab's job, if it belongs to the document on screen. Updates are batched per frame:
 * a stream emits an event per text delta.
 */
export function useJob(jobs: Jobs | undefined, tabId: number | undefined, docId: string | undefined): JobView | undefined {
  const read = () => (jobs && tabId !== undefined && docId !== undefined && jobs.docOf(tabId) === docId ? jobs.get(tabId) : undefined);
  const [job, setJob] = useState<JobView | undefined>(read);
  useEffect(() => {
    setJob(read());
    if (!jobs) return;
    let scheduled = false;
    let live = true;
    const unsubscribe = jobs.subscribe((id) => {
      if (id !== tabId || scheduled) return;
      scheduled = true;
      nextFrame(() => {
        scheduled = false;
        // A frame queued for an earlier document must not overwrite the current one's job.
        if (live) setJob(read());
      });
    });
    return () => {
      live = false;
      unsubscribe();
    };
    // read() closes over exactly these three.
  }, [jobs, tabId, docId]);
  return job;
}

/** The tab's selection. */
export function useSnippet(store: SnippetStore | undefined, tabId: number | undefined): SnippetView | undefined {
  const [view, setView] = useState<SnippetView | undefined>(() => (store && tabId !== undefined ? store.get(tabId) : undefined));
  useEffect(() => {
    setView(store && tabId !== undefined ? store.get(tabId) : undefined);
    return store?.subscribe((id, v) => {
      if (id === tabId) setView(v);
    });
  }, [store, tabId]);
  return view;
}

/**
 * The notice's state, as the panel shows it: `needed` only while a run waits for it (a route that
 * sends text off the device, jobs.ts); on-device translation never asks.
 */
export function usePrivacy(gate: PrivacyGate | undefined): PrivacyState | undefined {
  const read = () => (gate?.state === 'needed' && !gate.pending ? 'unknown' : gate?.state);
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return gate?.subscribe(() => setState(read()));
  }, [gate]);
  return state;
}
