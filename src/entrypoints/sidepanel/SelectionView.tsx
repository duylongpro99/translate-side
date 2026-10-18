import { JobBar, type JobActions } from './JobBar.tsx';
import { i18n } from '#i18n';
import type { JobView } from './jobs.ts';
import { SegmentList } from './SegmentList.tsx';
import type { SnippetView } from './snippet.ts';

// Selection mode (plan M3-E4, DESIGN §3): the text the user selected and sent with the context
// menu, translated on its own. Works on any page, including ones whose text can't be extracted.
export function SelectionView({ snippet, job, actions, onClose, pageReady }: { snippet: SnippetView; job: JobView | undefined; actions: JobActions; onClose: () => void; pageReady: boolean }) {
  return (
    <section class="selection" data-testid="selection">
      <div class="selection__head">
        <h2 class="selection__title">{i18n.t('panel.selection.title')}</h2>
        <button type="button" class="ui-button" data-testid="selection-close" onClick={onClose}>
          {pageReady ? i18n.t('panel.selection.back') : i18n.t('panel.selection.close')}
        </button>
      </div>
      {snippet.blocked ? (
        <div class="state" data-state="blocked" role="alert">
          <p class="state__title">{i18n.t('panel.selection.blockedTitle')}</p>
          <p>{i18n.t(snippet.blocked === 'never' ? 'panel.state.never' : 'panel.state.denylisted')}</p>
        </div>
      ) : (
        <>
          {job ? <JobBar job={job} actions={actions} /> : <p class="panel__meta">{i18n.t('panel.selection.translating')}</p>}
          <SegmentList segments={job?.segments ?? snippet.segments} states={job?.segs} {...(job?.model ? { model: job.model } : {})} actions={{ retry: actions.retrySegment, retranslate: actions.retranslateSegment, explain: actions.explainSegment }} />
          {snippet.truncated ? <p class="state__hint">{i18n.t('panel.selection.truncated')}</p> : null}
        </>
      )}
    </section>
  );
}
