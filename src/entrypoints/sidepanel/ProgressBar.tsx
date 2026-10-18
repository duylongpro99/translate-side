import { i18n } from '#i18n';
import type { JobView } from './jobs.ts';

/**
 * The 2px bar under the header row while a page job runs: done blocks of all. Gone at once when the
 * job stops running (no fade). Screen readers hear progress from the job bar's live region.
 */
export function ProgressBar({ job }: { job: JobView | undefined }) {
  if (job?.status !== 'running') return null;
  const { final, total } = job.counts;
  const share = total > 0 ? Math.min(100, (final / total) * 100) : 0;
  return (
    <div class="progress" role="progressbar" aria-label={i18n.t('panel.header.progress')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={final} data-testid="progress">
      <span class="progress__fill" style={{ width: `${share}%` }} />
    </div>
  );
}
