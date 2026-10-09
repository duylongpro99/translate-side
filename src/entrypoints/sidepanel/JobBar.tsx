import { useEffect, useState } from 'preact/hooks';
import { languageLabel } from '@/engine/index';
import { formatUsd } from '@/shared/cost';
import type { Backoff, JobView } from './jobs.ts';
import { failureText } from './status.ts';
import type { LLMError } from '@/llm/types';

// The job's status line (plan M1-E10): progress, Cancel, and the cost readout. On the page view
// Cancel sits in the header (M3-E6), so the bar leaves it out there (`cancel={false}`).

export interface JobActions {
  cancel(): void;
  /** Translate what is left (after a cancel or failures), keeping the finals and the cost so far. */
  resume(): void;
  openOptions(): void;
  /** Translate this one failed segment again (its inline Retry, M3-E8). */
  retrySegment(id: string): void;
  /** This one block again, skipping the cache; its new text replaces the stored one (M3-E5, decision M3-D2). */
  retranslateSegment(id: string): void;
  /** The whole page again with the current settings, skipping the cache (the header, M3-E6; decision M3-D2). */
  retranslatePage(): void;
  /** Asks for the provider's host permission. Must run inside the click (a user gesture, §4.3.3). */
  grantAccess(): void;
  /** Past the monthly soft limit (M4-E10): no more warnings this month, and the translation goes on. */
  continuePastLimit(): void;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * One line per chunk waiting out a rate limit or a busy provider (plan M3-E8). With a Retry-After
 * it counts down; without one the retry comes within the engine's backoff, so it only says so.
 * Gone as soon as the chunk's next attempt starts.
 */
function BackoffNote({ entries }: { entries: readonly Backoff[] }) {
  const [now, setNow] = useState(() => Date.now());
  const counting = entries.some((e) => e.until !== undefined);
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [counting]);
  return (
    <ul class="job__backoff" data-testid="job-backoff" aria-live="polite">
      {entries.map((e) => {
        const why = e.kind === 'rate_limit' ? 'Rate limited' : e.kind === 'network' ? 'Connection problem' : 'Provider busy';
        const wait = e.until === undefined ? 'retrying shortly' : `retrying in ${Math.max(0, Math.ceil((e.until - now) / 1000))} s`;
        return (
          <li key={e.chunk} data-chunk={e.chunk} data-kind={e.kind}>
            {why}
            {e.chunk >= 0 ? ` · part ${e.chunk + 1}` : ''} · {wait}
            {e.attempt > 1 ? ` (attempt ${e.attempt})` : ''}
          </li>
        );
      })}
    </ul>
  );
}

export function JobBar({ job, actions, cancel: showCancel = true }: { job: JobView; actions: JobActions; cancel?: boolean }) {
  const { final, failed, total } = job.counts;
  const into = languageLabel(job.targetLang);
  // Providers report usage at the end of a stream, so a cancelled request's spend is unknown:
  // say so instead of estimating it (review E-T2).
  const cost = job.cost === undefined ? null : (
    <span class="job__cost" data-testid="job-cost" title={`${job.usage.input} input tokens (${job.usage.cachedInput} cached), ${job.usage.output} output tokens`}>
      {formatUsd(job.cost)}
      {job.unmetered > 0 ? <span class="job__cost-note"> · excludes cancelled requests</span> : null}
    </span>
  );
  // A fallback took over (M4-E9): say which model is translating now, and why.
  const fallbackNote = job.fallback ? (
    <span class="job__fallback" data-testid="job-fallback" role="note">
      {job.fallback.from} {fallbackWhy(job.fallback.error)}; {job.status === 'running' ? 'continuing' : 'continued'} with {job.fallback.to}. Blocks it translated are marked.
    </span>
  ) : null;
  const attrs = {
    class: `job job--${job.status}`,
    'data-testid': 'job',
    'data-status': job.status,
    'data-started': job.startedAt,
    ...(job.firstVisibleAt === undefined ? {} : { 'data-first-visible': job.firstVisibleAt }),
    ...(job.screenDoneAt === undefined ? {} : { 'data-screen-done': job.screenDoneAt }),
    ...(job.endedAt === undefined ? {} : { 'data-ended': job.endedAt }),
  };

  // The soft limit stopped a run or a block's redo (M4-E10): Continue anyway carries it out.
  if (job.limit && job.status !== 'running') {
    return (
      <div {...attrs} role="alert" data-testid="job-limit">
        <span class="job__text">
          This month's spend ({formatUsd(job.limit.monthUsd)}) reached your soft limit of {formatUsd(job.limit.limitUsd)}. Nothing was sent.
          {job.limit.failed ? (
            <>
              {' '}
              <span data-testid="limit-failed">{job.limit.failed}</span>
            </>
          ) : null}
        </span>
        <button type="button" class="job__button" data-testid="limit-continue" onClick={actions.continuePastLimit}>
          Continue anyway
        </button>
        <button type="button" class="job__button" onClick={actions.openOptions}>
          Settings
        </button>
      </div>
    );
  }

  switch (job.status) {
    case 'running':
      return (
        <div {...attrs} role="status">
          <span class="job__text">
            Translating into {into}… {final} of {total}
            {failed ? ` · ${failed} failed` : ''}
          </span>
          {cost}
          {showCancel ? (
            <button type="button" class="job__button" onClick={actions.cancel}>
              Cancel
            </button>
          ) : null}
          {job.backoff?.length ? <BackoffNote entries={job.backoff} /> : null}
          {fallbackNote}
        </div>
      );
    case 'done':
      return (
        <div {...attrs} role="status">
          <span class="job__text">
            {into} · {final} of {total}
            {failed ? ` · ${failed} failed` : ''}
            {job.endedAt === undefined ? '' : ` · ${seconds(job.endedAt - job.startedAt)}`}
          </span>
          {cost}
          {failed ? (
            <button type="button" class="job__button" onClick={actions.resume}>
              Retry failed
            </button>
          ) : null}
          {fallbackNote}
        </div>
      );
    case 'cancelled':
      return (
        <div {...attrs} role="status">
          <span class="job__text">
            Cancelled · {final} of {total} translated
          </span>
          {cost}
          <button type="button" class="job__button" onClick={actions.resume}>
            Translate the rest
          </button>
        </div>
      );
    case 'skipped': {
      // Plan M2 criterion 6: nothing was sent; say why, and offer the way out if detection was wrong.
      const how =
        job.detection?.via === 'override' ? 'your source-language setting' : job.detection?.via === 'html-lang' ? "the page's language tag" : 'language detection on this device';
      return (
        <div {...attrs} role="status">
          <span class="job__text" data-testid="job-skipped">
            This page is already in {into}, so it was not translated ({how}).
          </span>
          {cost}
          <button type="button" class="job__button" onClick={actions.resume}>
            Translate anyway
          </button>
        </div>
      );
    }
    case 'stopped': {
      const error = job.stopError;
      const fix =
        error?.kind === 'auth' ? (
          <button type="button" class="job__button job__button--fix" data-testid="fix-key" onClick={actions.openOptions} title={job.connection ? `Open the settings of ${job.connection.label}` : 'Open settings'}>
            Fix key
          </button>
        ) : error?.kind === 'cors' && error.cause === 'permission' ? (
          <button type="button" class="job__button" onClick={actions.grantAccess}>
            Grant access
          </button>
        ) : (
          <button type="button" class="job__button" data-testid="retry-page" onClick={actions.resume}>
            {error?.kind === 'network' ? 'Retry' : 'Try again'}
          </button>
        );
      // A dropped connection: what is translated stays, Retry does only the rest (M3-E8).
      const text = error?.kind === 'network' ? `Lost the connection · ${final} of ${total} translated, the rest is waiting` : error ? capitalize(failureText(error)) : 'Stopped';
      // Under a local-only site rule the job had no cloud fallback to go on with (M4-D tester O1).
      const local = job.localOnly !== undefined && error !== undefined && (error.kind === 'network' || error.kind === 'rate_limit' || error.kind === 'overloaded');
      if (local) {
        const who = job.connection?.label ?? 'The local model';
        const what = error.kind === 'network' ? `${who} can't be reached · ${final} of ${total} translated, the rest is waiting` : `${who} ${fallbackWhy(error)} · ${final} of ${total} translated`;
        return (
          <div {...attrs} role="alert" data-testid="job-local-only">
            <span class="job__text">
              {what}. The local-only rule for {job.localOnly} keeps this page off cloud providers, so it did not fall back to one.
            </span>
            {cost}
            {fix}
          </div>
        );
      }
      return (
        <div {...attrs} role="alert">
          <span class="job__text">{text}</span>
          {cost}
          {fix}
        </div>
      );
    }
  }
}

const fallbackWhy = (error: LLMError) => (error.kind === 'rate_limit' ? 'is rate limited' : error.kind === 'network' ? 'is unreachable' : 'is overloaded');

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
