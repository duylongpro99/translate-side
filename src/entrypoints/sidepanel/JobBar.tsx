import { useEffect, useState } from 'preact/hooks';
import { languageName } from '@/shared/language-name';
import { formatUsd } from '@/shared/cost';
import type { Backoff, JobView } from './jobs.ts';
import { i18n } from '#i18n';
import { failureText, noBasicText } from './status.ts';
import type { LLMError } from '@/llm/types';
import type { OnDeviceEngine } from '@/llm/on-device';

// The job's status line (plan M1-E10): progress, Cancel, and the cost readout. On the page view
// (`inHeader`) the header carries the progress (its 2px bar), Cancel (its Stop icon) and the cost
// (the Translation popover), so the bar only shows what needs attention: failures, the rest of a
// long page, notes, errors and limits. Its progress sentence is still said to screen readers.

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
  /** Saves the user's correction of a finished block (the translation memory). Absent: blocks cannot be edited. */
  editSegment?(id: string, text: string): void;
  /** Retranslates an edited block once the user confirmed it, replacing the correction. */
  discardEdit?(id: string): void;
  /** The whole page again with the current settings, skipping the cache (the header, M3-E6; decision M3-D2). */
  retranslatePage(): void;
  /** Asks for the provider's host permission. Must run inside the click (a user gesture, §4.3.3). */
  grantAccess(): void;
  /** Past the monthly soft limit (M4-E10): no more warnings this month, and the translation goes on. */
  continuePastLimit(): void;
  /**
   * Turns on on-device translation for a pair: creates the engine (downloading it when needed),
   * then translates again. Must run inside the click: Chrome's Translator needs the gesture.
   */
  turnOnDevice?(engine: OnDeviceEngine, from: string, to: string): void;
  /** Stops the turn-on download. */
  cancelOnDevice?(): void;
  /** Opens the first-run guide, to set up a provider (on-device translation can't run). */
  setUpProvider?(): void;
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

const pairOf = (from: string, to: string) => `${languageName(from)} → ${languageName(to)}`;

/** The shell's tag on an error (status.ts uiError), with its arguments. */
const uiOf = (error: LLMError | undefined): { ui: string; args: string[] } | undefined => {
  const raw = error?.raw as { ui?: unknown; args?: unknown } | undefined;
  return typeof raw?.ui === 'string' ? { ui: raw.ui, args: Array.isArray(raw.args) ? raw.args.map(String) : [] } : undefined;
};

/** The turn-on button for a pair: creates the engine in this click (the Translator needs the gesture). */
function TurnOn({ engine, from, to, actions, label }: { engine: OnDeviceEngine; from: string; to: string; actions: JobActions; label?: string }) {
  if (!actions.turnOnDevice) return null;
  return (
    <button type="button" class="ui-button ui-button--primary" data-testid="on-device-turn-on" onClick={() => actions.turnOnDevice?.(engine, from, to)}>
      {label ?? i18n.t('panel.job.onDevice.turnOn')}
    </button>
  );
}

/** The turn-on download: its progress and Cancel, or why it failed and Try again. */
function DownloadNote({ download, actions }: { download: NonNullable<JobView['onDeviceDownload']>; actions: JobActions }) {
  const { engine, from, to, loaded, error } = download;
  if (error !== undefined) {
    return (
      <div class="job__say job__say--warn" data-testid="on-device-download-failed">
        <span class="job__text">{i18n.t('panel.job.onDevice.failed', [pairOf(from, to), error])}</span>
        <TurnOn engine={engine} from={from} to={to} actions={actions} label={i18n.t('panel.job.tryAgain')} />
      </div>
    );
  }
  const percent = Math.round(Math.min(1, Math.max(0, loaded)) * 100);
  return (
    <div class="job__say" data-testid="on-device-download">
      <span class="job__text">{i18n.t(engine === 'nano' ? 'panel.job.onDevice.downloadingNano' : 'panel.job.onDevice.downloading', [pairOf(from, to), String(percent)])}</span>
      <progress class="job__download" max={100} value={percent} aria-label={i18n.t('panel.job.onDevice.progress')} />
      {actions.cancelOnDevice ? (
        <button type="button" class="ui-button" data-testid="on-device-cancel" onClick={actions.cancelOnDevice}>
          {i18n.t('panel.job.cancel')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * On-device translation can't run yet (the route's stop, route.ts): what to click, or why it can't
 * and the way to a provider. Undefined for any other stop.
 */
function onDeviceStop(job: JobView, actions: JobActions) {
  const tag = uiOf(job.stopError);
  if (tag === undefined || !tag.ui.startsWith('onDevice')) return undefined;
  if (job.onDeviceDownload) return <DownloadNote download={job.onDeviceDownload} actions={actions} />;
  const [first = '', from = '', to = ''] = tag.args;
  const setUp = actions.setUpProvider ? (
    <button type="button" class="ui-button" data-testid="on-device-set-up" onClick={actions.setUpProvider}>
      {i18n.t('panel.job.onDevice.setUp')}
    </button>
  ) : null;
  switch (tag.ui) {
    case 'onDeviceSetup': {
      const engine = first === 'nano' ? 'nano' : 'translator';
      return (
        <div class="job__say" data-testid="on-device-setup">
          <span class="job__text">{i18n.t(engine === 'nano' ? 'panel.job.onDevice.setupNano' : 'panel.job.onDevice.setup', [pairOf(from, to)])}</span>
          <TurnOn engine={engine} from={from} to={to} actions={actions} />
          {setUp}
        </div>
      );
    }
    case 'onDeviceDownloading':
      return (
        <div class="job__say" data-testid="on-device-downloading">
          <span class="job__text">{i18n.t('panel.job.onDevice.chromeDownloading', [pairOf(from, to)])}</span>
          <button type="button" class="ui-button" onClick={actions.resume}>
            {i18n.t('panel.job.onDevice.checkAgain')}
          </button>
        </div>
      );
    default: {
      const text = tag.ui === 'onDeviceNoSource' ? i18n.t('panel.job.onDevice.noSource') : first === 'pair' ? i18n.t('panel.job.onDevice.pair', [pairOf(from, to)]) : first === 'setting' ? i18n.t('panel.job.onDevice.setting') : i18n.t('panel.job.onDevice.noApi');
      return (
        <div class="job__say job__say--warn" data-testid="on-device-unavailable">
          <span class="job__text">{text}</span>
          {setUp}
        </div>
      );
    }
  }
}

export function JobBar({ job, actions, inHeader = false }: { job: JobView; actions: JobActions; inHeader?: boolean }) {
  const showCancel = !inHeader;
  const { final, failed, total } = job.counts;
  const into = languageName(job.targetLang);
  // Providers report usage at the end of a stream, so a cancelled request's spend is unknown:
  // say so instead of estimating it (review E-T2).
  const cost = job.cost === undefined || inHeader ? null : (
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
  // A second language on the page needs its own turn-on click (found mid-run, a mixed page).
  const second = job.onDeviceSetup;
  const pairNote = job.onDeviceDownload && job.status !== 'stopped' ? (
    <DownloadNote download={job.onDeviceDownload} actions={actions} />
  ) : second ? (
    <div class="job__say" data-testid="on-device-second-pair" role="note">
      <span class="job__text">{i18n.t('panel.job.onDevice.second', [languageName(second.from), pairOf(second.from, second.to)])}</span>
      <TurnOn engine={second.engine} from={second.from} to={second.to} actions={actions} />
    </div>
  ) : null;
  // Best was asked for but its review route cannot run: the page is translated without the review.
  const reviewNote = job.reviewUnavailable ? (
    <span class="job__review" data-testid="job-review-unavailable" role="note">
      {i18n.t('panel.job.reviewUnavailable', [failureText(job.reviewUnavailable)])}
    </span>
  ) : null;
  // A Retranslate page that ended early (M3 dogfood B2): some blocks show their earlier translation.
  const keptNote = job.kept ? (
    <span class="job__kept" data-testid="job-kept" role="note">
      {i18n.t('panel.job.kept', job.kept)}
    </span>
  ) : null;
  // Retranslate page left the user's corrections as they are.
  const editsNote = job.editsKept ? (
    <span class="job__kept" data-testid="job-edits-kept" role="note">
      {i18n.t('panel.job.editsKept', job.editsKept)}
    </span>
  ) : null;
  // Lazy mode (M5-E4): the page is long, so only the part around the reader is translated.
  const restButton = job.lazy ? (
    <button type="button" class="ui-button" data-testid="translate-rest" title={i18n.t('panel.job.restTitle', job.lazy.rest)} onClick={actions.translateRest}>
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
        <button type="button" class="ui-button" data-testid="limit-continue" onClick={actions.continuePastLimit}>
          {i18n.t('panel.job.continueAnyway')}
        </button>
        <button type="button" class="ui-button" onClick={actions.openOptions}>
          {i18n.t('panel.job.settings')}
        </button>
      </div>
    );
  }

  if (inHeader && (job.status === 'running' || job.status === 'done')) {
    const running = job.status === 'running';
    const sentence = running
      ? `${i18n.t('panel.job.running', [into, String(final), String(total)])}${failed ? ` · ${i18n.t('panel.job.failed', [String(failed)])}` : ''}`
      : `${i18n.t('panel.job.done', [into, String(final), String(total)])}${failed ? ` · ${i18n.t('panel.job.failed', [String(failed)])}` : ''}${job.lazy ? ` · ${i18n.t('panel.job.restAsRead')}` : job.endedAt === undefined ? '' : ` · ${seconds(job.endedAt - job.startedAt)}`}`;
    const retry = !running && (failed || job.kept) ? (
      <button type="button" class="ui-button" data-testid="retry-failed" onClick={actions.resume}>
        {failed ? i18n.t('panel.job.retryFailed') : i18n.t('panel.job.retry')}
      </button>
    ) : null;
    return (
      // The wrapper is the live region, as before: the sentence, the failures and every note are said.
      <div {...attrs} role="status">
        <p class="sr-only" data-testid="job-live">
          {sentence}
        </p>
        {failed ? (
          <div class="job__say job__say--warn">
            {/* Already in the sentence above: shown, not read twice. */}
            <span class="job__text" aria-hidden="true">
              {i18n.t('panel.job.failed', [String(failed)])}
            </span>
            {retry}
          </div>
        ) : null}
        {job.lazy ? (
          <div class="job__say">
            <span class="job__text">{i18n.t('panel.job.restAsRead')}</span>
            {restButton}
          </div>
        ) : null}
        {!running && job.kept ? (
          <div class="job__say">
            {keptNote}
            {failed ? null : retry}
          </div>
        ) : null}
        {running && job.backoff?.length ? <BackoffNote entries={job.backoff} /> : null}
        {editsNote}
        {fallbackNote}
        {reviewNote}
        {pairNote}
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
            <button type="button" class="ui-button" onClick={actions.cancel}>
              {i18n.t('panel.job.cancel')}
            </button>
          ) : null}
          {job.backoff?.length ? <BackoffNote entries={job.backoff} /> : null}
          {editsNote}
          {fallbackNote}
          {reviewNote}
          {pairNote}
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
          {editsNote}
          {restButton}
          {failed || job.kept ? (
            <button type="button" class="ui-button" data-testid="retry-failed" onClick={actions.resume}>
              {failed ? i18n.t('panel.job.retryFailed') : i18n.t('panel.job.retry')}
            </button>
          ) : null}
          {fallbackNote}
          {reviewNote}
          {pairNote}
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
          {editsNote}
          <button type="button" class="ui-button" data-testid="translate-rest" onClick={job.lazy ? actions.translateRest : actions.resume}>
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
          <button type="button" class="ui-button" onClick={actions.resume}>
            {i18n.t('panel.job.translateAnyway')}
          </button>
        </div>
      );
    }
    case 'stopped': {
      const onDevice = onDeviceStop(job, actions);
      if (onDevice) {
        return (
          <div {...attrs} role="alert" data-testid="job-on-device">
            {onDevice}
          </div>
        );
      }
      const error = job.stopError;
      const fix =
        error?.kind === 'auth' ? (
          <button type="button" class="ui-button job__button--fix" data-testid="fix-key" onClick={actions.openOptions} title={job.connection ? i18n.t('panel.job.fixKeyTitle', [job.connection.label]) : i18n.t('panel.job.openSettings')}>
            {i18n.t('panel.job.fixKey')}
          </button>
        ) : error?.kind === 'cors' && error.cause === 'permission' ? (
          <button type="button" class="ui-button" onClick={actions.grantAccess}>
            {i18n.t('panel.job.grantAccess')}
          </button>
        ) : (
          <button type="button" class="ui-button" data-testid="retry-page" onClick={actions.resume}>
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
