import { useEffect, useState } from 'preact/hooks';
import { languageLabel } from '@/engine/index';
import { formatUsd } from '@/shared/cost';
import type { Backoff, JobView } from './jobs.ts';
import { i18n } from '#i18n';
import { failureText, noBasicText } from './status.ts';
import type { LLMError } from '@/llm/types';

// The job's status line (plan M1-E10): progress, Cancel, and the cost readout. On the page view
// Cancel sits in the header (M3-E6), so the bar leaves it out there (`cancel={false}`).

export interface JobActions {
  cancel(): void;
  /** Translate what is left (after a cancel or failures), keeping the finals and the cost so far. */
  resume(): void;
  /** A long page is translated around the reader (lazy mode, M5-E4): translate all of it now. */
  translateRest(): void;
  openOptions(): void;
  /** Translate this one failed segment again (its inline Retry, M3-E8). */
  retrySegment(id: string): void;
  /** This one block again, skipping the cache; its new text replaces the stored one (M3-E5, decision M3-D2). */
  retranslateSegment(id: string): void;
  /** A short note on this block's idioms and cultural references (its Explain this, M5-E8). */
  explainSegment(id: string): void;
  /** The whole page again with the current settings, skipping the cache (the header, M3-E6; decision M3-D2). */
  retranslatePage(): void;
  /** Asks for the provider's host permission. Must run inside the click (a user gesture, §4.3.3). */
  grantAccess(): void;
  /** Past the monthly soft limit (M4-E10): no more warnings this month, and the translation goes on. */
  continuePastLimit(): void;
}

const seconds = (ms: number) => i18n.t('panel.job.seconds', [(ms / 1000).toFixed(1)]);

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
        const why = i18n.t(e.kind === 'rate_limit' ? 'panel.job.backoff.rateLimit' : e.kind === 'network' ? 'panel.job.backoff.network' : 'panel.job.backoff.busy');
        const wait = e.until === undefined ? i18n.t('panel.job.backoff.soon') : i18n.t('panel.job.backoff.in', [String(Math.max(0, Math.ceil((e.until - now) / 1000)))]);
        return (
          <li key={e.chunk} data-chunk={e.chunk} data-kind={e.kind}>
            {why}
            {e.chunk >= 0 ? ` · ${i18n.t('panel.job.backoff.part', [String(e.chunk + 1)])}` : ''} · {wait}
            {e.attempt > 1 ? ` ${i18n.t('panel.job.backoff.attempt', [String(e.attempt)])}` : ''}
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
    <span class="job__cost" data-testid="job-cost" title={i18n.t('panel.job.costTitle', [String(job.usage.input), String(job.usage.cachedInput), String(job.usage.output)])}>
      {formatUsd(job.cost)}
      {job.unmetered > 0 ? <span class="job__cost-note"> · {i18n.t('panel.job.excludesCancelled')}</span> : null}
    </span>
  );
  // A fallback took over (M4-E9): say which model is translating now, and why.
  const fallbackNote = job.fallback ? (
    <span class="job__fallback" data-testid="job-fallback" role="note">
      {(() => {
        const { from, to, error, basic, recovered } = job.fallback;
        const running = job.status === 'running';
        const sawBasic = [...job.segs.values()].some((s) => s.basic);
        const why = i18n.t(fallbackWhy(error));
        if (basic && recovered) {
          // Every provider gave up and Chrome's Translator took over (or could not either) for a while, until a provider answered again.
          return i18n.t(sawBasic ? 'panel.job.fallback.recoveredBasic' : 'panel.job.fallback.recoveredNoBasic', [from, i18n.t(fallbackWhyPast(error)), to, i18n.t(running ? 'panel.job.fallback.againRunning' : 'panel.job.fallback.againDone')]);
        }
        if (basic) {
          if (!running && !sawBasic) return i18n.t('panel.job.fallback.basicNoHelp', [from, why, to]);
          return i18n.t(running ? 'panel.job.fallback.basicContinuing' : 'panel.job.fallback.basicContinued', [from, why, to]);
        }
        return i18n.t(running ? 'panel.job.fallback.continuing' : 'panel.job.fallback.continued', [from, why, to]);
      })()}
    </span>
  ) : null;
  // A Retranslate page that ended early (M3 dogfood B2): some blocks show their earlier translation.
  const keptNote = job.kept ? (
    <span class="job__kept" data-testid="job-kept" role="note">
      {i18n.t('panel.job.kept', job.kept)}
    </span>
  ) : null;
  // Lazy mode (M5-E4): the page is long, so only the part around the reader is translated.
  const restButton = job.lazy ? (
    <button type="button" class="job__button" data-testid="translate-rest" title={i18n.t('panel.job.restTitle', job.lazy.rest)} onClick={actions.translateRest}>
      {i18n.t('panel.job.translateRest')}
    </button>
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
          {i18n.t('panel.job.limit', [formatUsd(job.limit.monthUsd), formatUsd(job.limit.limitUsd)])}
          {job.limit.failed ? (
            <>
              {' '}
              <span data-testid="limit-failed">{job.limit.failed}</span>
            </>
          ) : null}
        </span>
        <button type="button" class="job__button" data-testid="limit-continue" onClick={actions.continuePastLimit}>
          {i18n.t('panel.job.continueAnyway')}
        </button>
        <button type="button" class="job__button" onClick={actions.openOptions}>
          {i18n.t('panel.job.settings')}
        </button>
      </div>
    );
  }

  switch (job.status) {
    case 'running':
      return (
        <div {...attrs} role="status">
          <span class="job__text">
            {i18n.t('panel.job.running', [into, String(final), String(total)])}
            {failed ? ` · ${i18n.t('panel.job.failed', [String(failed)])}` : ''}
          </span>
          {cost}
          {restButton}
          {showCancel ? (
            <button type="button" class="job__button" onClick={actions.cancel}>
              {i18n.t('panel.job.cancel')}
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
            {i18n.t('panel.job.done', [into, String(final), String(total)])}
            {failed ? ` · ${i18n.t('panel.job.failed', [String(failed)])}` : ''}
            {job.lazy ? ` · ${i18n.t('panel.job.restAsRead')}` : job.endedAt === undefined ? '' : ` · ${seconds(job.endedAt - job.startedAt)}`}
          </span>
          {cost}
          {keptNote}
          {restButton}
          {failed || job.kept ? (
            <button type="button" class="job__button" data-testid="retry-failed" onClick={actions.resume}>
              {failed ? i18n.t('panel.job.retryFailed') : i18n.t('panel.job.retry')}
            </button>
          ) : null}
          {fallbackNote}
        </div>
      );
    case 'cancelled':
      return (
        <div {...attrs} role="status">
          <span class="job__text">
            {i18n.t('panel.job.cancelled', [String(final), String(total)])}
          </span>
          {cost}
          {keptNote}
          <button type="button" class="job__button" data-testid="translate-rest" onClick={job.lazy ? actions.translateRest : actions.resume}>
            {i18n.t('panel.job.translateRest')}
          </button>
        </div>
      );
    case 'skipped': {
      // Plan M2 criterion 6: nothing was sent; say why, and offer the way out if detection was wrong.
      const how = i18n.t(job.detection?.via === 'override' ? 'panel.job.how.override' : job.detection?.via === 'html-lang' ? 'panel.job.how.htmlLang' : 'panel.job.how.detected');
      return (
        <div {...attrs} role="status">
          <span class="job__text" data-testid="job-skipped">
            {i18n.t('panel.job.skipped', [into, how])}
          </span>
          {cost}
          <button type="button" class="job__button" onClick={actions.resume}>
            {i18n.t('panel.job.translateAnyway')}
          </button>
        </div>
      );
    }
    case 'stopped': {
      const error = job.stopError;
      const fix =
        error?.kind === 'auth' ? (
          <button type="button" class="job__button job__button--fix" data-testid="fix-key" onClick={actions.openOptions} title={job.connection ? i18n.t('panel.job.fixKeyTitle', [job.connection.label]) : i18n.t('panel.job.openSettings')}>
            {i18n.t('panel.job.fixKey')}
          </button>
        ) : error?.kind === 'cors' && error.cause === 'permission' ? (
          <button type="button" class="job__button" onClick={actions.grantAccess}>
            {i18n.t('panel.job.grantAccess')}
          </button>
        ) : (
          <button type="button" class="job__button" data-testid="retry-page" onClick={actions.resume}>
            {error?.kind === 'network' ? i18n.t('panel.job.retry') : i18n.t('panel.job.tryAgain')}
          </button>
        );
      // A dropped connection: what is translated stays, Retry does only the rest (M3-E8).
      // Every provider down and Chrome's Translator could not help either (M5-E7): said after the stop.
      const basic = error && noBasicText(error);
      const noBasic = basic === undefined ? '' : ` ${basic}`;
      const text = error?.kind === 'network' ? `${i18n.t('panel.job.lostConnection', [String(final), String(total)])}${basic === undefined ? '' : '.'}${noBasic}` : error ? `${capitalize(failureText(error))}${basic === undefined ? '' : '.'}` : i18n.t('panel.job.stopped');
      // Under a local-only site rule the job had no cloud fallback to go on with (M4-D tester O1).
      const local = job.localOnly !== undefined && error !== undefined && (error.kind === 'network' || error.kind === 'rate_limit' || error.kind === 'overloaded');
      if (local) {
        const who = job.connection?.label ?? i18n.t('panel.job.localModel');
        const what = error.kind === 'network' ? i18n.t('panel.job.localUnreachable', [who, String(final), String(total)]) : i18n.t('panel.job.localBusy', [who, i18n.t(fallbackWhy(error)), String(final), String(total)]);
        return (
          <div {...attrs} role="alert" data-testid="job-local-only">
            <span class="job__text">
              {what}. {i18n.t('panel.job.localOnly', [job.localOnly as string])}{noBasic}
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
          {keptNote}
          {fix}
        </div>
      );
    }
  }
}

const fallbackWhy = (error: LLMError) => (error.kind === 'rate_limit' ? 'panel.job.why.rateLimit' : error.kind === 'network' ? 'panel.job.why.network' : 'panel.job.why.overloaded') as 'panel.job.why.rateLimit' | 'panel.job.why.network' | 'panel.job.why.overloaded';
const fallbackWhyPast = (error: LLMError) => (error.kind === 'rate_limit' ? 'panel.job.whyPast.rateLimit' : error.kind === 'network' ? 'panel.job.whyPast.network' : 'panel.job.whyPast.overloaded') as 'panel.job.whyPast.rateLimit' | 'panel.job.whyPast.network' | 'panel.job.whyPast.overloaded';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
