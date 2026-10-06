import type { Segment } from '@/engine/types';

// Dev-only segment view (plan M0-E7): ids, kinds and paths, to check extraction and id
// stability (demo step 4). Rendered only when import.meta.env.DEV, so production builds drop it.
export function DevView({ segments, via, docId }: { segments: Segment[]; via: string; docId: string }) {
  return (
    <section class="dev" data-testid="dev-view">
      <p class="dev__meta">
        via {via} · {segments.length} segments · doc {docId.slice(0, 8)}
      </p>
      <table class="dev__table">
        <thead>
          <tr>
            <th>id</th>
            <th>kind</th>
            <th>flags</th>
            <th>domPath / text</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr key={s.id} data-id={s.id}>
              <td class="dev__id">{s.id}</td>
              <td>
                {s.kind}
                {s.level ? s.level : ''}
              </td>
              <td>{[s.translate ? '' : 'no-translate', s.hidden ? 'hidden' : '', s.groupId ?? '', s.codeLang ?? ''].filter(Boolean).join(' ')}</td>
              <td>
                <div class="dev__path">{s.domPath}</div>
                <div class="dev__text">{s.inlineMarkup.length > 160 ? `${s.inlineMarkup.slice(0, 160)}…` : s.inlineMarkup}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
