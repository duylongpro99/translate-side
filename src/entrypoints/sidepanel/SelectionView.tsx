import { DENYLIST_MESSAGE } from '@/shared/snippet';
import { JobBar, type JobActions } from './JobBar.tsx';
import type { JobView } from './jobs.ts';
import { SegmentList } from './SegmentList.tsx';
import type { SnippetView } from './snippet.ts';

// Selection mode (plan M3-E4, DESIGN §3): the text the user selected and sent with the context
// menu, translated on its own. Works on any page, including ones whose text can't be extracted.
export function SelectionView({ snippet, job, actions, onClose, pageReady }: { snippet: SnippetView; job: JobView | undefined; actions: JobActions; onClose: () => void; pageReady: boolean }) {
  return (
    <section class="selection" data-testid="selection">
      <div class="selection__head">
        <h2 class="selection__title">Selection</h2>
        <button type="button" class="job__button" data-testid="selection-close" onClick={onClose}>
          {pageReady ? 'Back to the page' : 'Close'}
        </button>
      </div>
      {snippet.blocked ? (
        <div class="state" data-state="blocked" role="alert">
          <p class="state__title">Can't translate this selection</p>
          <p>{DENYLIST_MESSAGE}</p>
        </div>
      ) : (
        <>
          {job ? <JobBar job={job} actions={actions} /> : <p class="panel__meta">Translating the selection…</p>}
          <SegmentList segments={job?.segments ?? snippet.segments} states={job?.segs} {...(job?.model ? { model: job.model } : {})} actions={{ retry: actions.retrySegment, retranslate: actions.retranslateSegment }} />
          {snippet.truncated ? <p class="state__hint">Only the first part of a long selection is translated.</p> : null}
        </>
      )}
    </section>
  );
}
