import { languageLabel } from '@/engine/index';
import { formatUsd } from '@/shared/cost';
import type { JobView } from './jobs.ts';
import { failureText } from './status.ts';

// The job's status line (plan M1-E10): progress, Cancel, and the cost readout.

export interface JobActions {
  cancel(): void;
  /** Translate what is left (after a cancel or failures), keeping the finals and the cost so far. */
  resume(): void;
  openOptions(): void;
  /** Asks for the provider's host permission. Must run inside the click (a user gesture, §4.3.3). */
  grantAccess(): void;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function JobBar({ job, actions }: { job: JobView; actions: JobActions }) {
  const { final, failed, total } = job.counts;
  const into = languageLabel(job.targetLang);
  const cost = job.cost === undefined ? null : (
    <span class="job__cost" data-testid="job-cost" title={`${job.usage.input} input tokens (${job.usage.cachedInput} cached), ${job.usage.output} output tokens`}>
      {formatUsd(job.cost)}
    </span>
  );
  const attrs = {
    class: `job job--${job.status}`,
    'data-testid': 'job',
    'data-status': job.status,
    'data-started': job.startedAt,
    ...(job.firstVisibleAt === undefined ? {} : { 'data-first-visible': job.firstVisibleAt }),
    ...(job.endedAt === undefined ? {} : { 'data-ended': job.endedAt }),
  };

  switch (job.status) {
    case 'running':
      return (
        <div {...attrs} role="status">
          <span class="job__text">
            Translating into {into}… {final} of {total}
            {failed ? ` · ${failed} failed` : ''}
          </span>
          {cost}
          <button type="button" class="job__button" onClick={actions.cancel}>
            Cancel
          </button>
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
    case 'stopped': {
      const error = job.stopError;
      const fix =
        error?.kind === 'auth' ? (
          <button type="button" class="job__button" onClick={actions.openOptions}>
            Open settings
          </button>
        ) : error?.kind === 'cors' && error.cause === 'permission' ? (
          <button type="button" class="job__button" onClick={actions.grantAccess}>
            Grant access
          </button>
        ) : (
          <button type="button" class="job__button" onClick={actions.resume}>
            Try again
          </button>
        );
      return (
        <div {...attrs} role="alert">
          <span class="job__text">{error ? capitalize(failureText(error)) : 'Stopped'}</span>
          {cost}
          {fix}
        </div>
      );
    }
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
