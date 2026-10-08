import { Component, type ComponentChildren } from 'preact';
import type { Segment } from '@/engine/types';
import type { JobView, SegState } from './jobs.ts';
import { markerKinds, parseMarkup, type MarkupNode } from './markup.ts';
import { failureText } from './status.ts';

/** Per-segment actions (M3-E8); absent for a list with nothing to act on. */
export interface SegmentActions {
  retry(id: string): void;
}

// Segments rendered by kind (plan M0-E7), with the translation streaming in (plan M1-E10).
// Everything is rendered as text, never HTML (DESIGN.md §5.6, §8). A translatable segment shows
// its original (dimmed) until text arrives, the live preview while it streams, then the final.

function Markup({ nodes }: { nodes: MarkupNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return n.text;
          case 'code':
            return <code key={i}>{n.text}</code>;
          case 'em':
            return (
              <em key={i}>
                <Markup nodes={n.children} />
              </em>
            );
          case 'link':
            // Shown as a link, not followed: the panel has no URL for it (markers carry none).
            return (
              <span key={i} class="seg__link">
                <Markup nodes={n.children} />
              </span>
            );
        }
      })}
    </>
  );
}

/** The translation if there is one, else the original; formatting only where the source has it (NB6). */
function Text({ seg, state }: { seg: Segment; state: SegState | undefined }) {
  const src = state?.text ?? seg.inlineMarkup;
  return <Markup nodes={parseMarkup(src, markerKinds(seg))} />;
}

type Props = { seg: Segment; state: SegState | undefined; actions?: SegmentActions | undefined };

function statusAttrs(seg: Segment, state: SegState | undefined, extra = '') {
  const status = seg.translate ? (state?.status ?? 'original') : 'kept';
  return {
    'data-id': seg.id,
    'data-kind': seg.kind,
    'data-status': status,
    class: `seg seg--${seg.kind} seg--${status}${seg.hidden ? ' seg--hidden' : ''}${extra}`,
  };
}

function Notes({ seg, state, actions }: Props) {
  return (
    <>
      {seg.hidden ? <span class="seg__note">hidden on the page (tab or collapsed section)</span> : null}
      {state?.status === 'failed' && state.error ? (
        <span class="seg__note seg__note--failed" role="note">
          Not translated: {failureText(state.error)}
          {actions && state.error.kind !== 'auth' ? (
            <button type="button" class="seg__retry" data-testid="segment-retry" onClick={() => actions.retry(seg.id)}>
              Retry
            </button>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/** Re-renders only when its segment's state object changes: a stream updates one block at a time. */
class Block extends Component<Props> {
  override shouldComponentUpdate(next: Props): boolean {
    return next.seg !== this.props.seg || next.state !== this.props.state;
  }

  override render({ seg, state, actions }: Props) {
    const common = statusAttrs(seg, state);
    switch (seg.kind) {
      case 'heading':
        return (
          <div {...common} role="heading" aria-level={seg.level ?? 2} data-level={seg.level ?? 2}>
            <Text seg={seg} state={state} />
            <Notes seg={seg} state={state} actions={actions} />
          </div>
        );
      case 'code':
        return (
          <figure {...common}>
            <figcaption class="seg__label">
              {seg.codeLang ? `${seg.codeLang} · ` : ''}code, kept as is{seg.hidden ? ' · hidden on the page' : ''}
            </figcaption>
            <pre>
              <code>{seg.text}</code>
            </pre>
          </figure>
        );
      case 'li':
        return (
          <div {...common} role="listitem">
            <Text seg={seg} state={state} />
            <Notes seg={seg} state={state} actions={actions} />
          </div>
        );
      case 'quote':
        return (
          <blockquote {...common}>
            <Text seg={seg} state={state} />
            <Notes seg={seg} state={state} actions={actions} />
          </blockquote>
        );
      default:
        return (
          <p {...common}>
            <Text seg={seg} state={state} />
            <Notes seg={seg} state={state} actions={actions} />
          </p>
        );
    }
  }
}

class Cell extends Component<Props> {
  override shouldComponentUpdate(next: Props): boolean {
    return next.seg !== this.props.seg || next.state !== this.props.state;
  }

  override render({ seg, state, actions }: Props) {
    const { class: cls, ...attrs } = statusAttrs(seg, state);
    return (
      <div {...attrs} class={cls.replace(`seg--${seg.kind}`, 'seg--table-cell')} role="cell">
        <Text seg={seg} state={state} />
        <Notes seg={seg} state={state} actions={actions} />
      </div>
    );
  }
}

/**
 * The table a row segment belongs to: its domPath up to the last table step. Blocks inside a cell
 * (a list, a quote) carry the row's groupId too. Undefined outside tables.
 */
function tableOf(seg: Segment): string | undefined {
  if (!seg.groupId) return undefined;
  // `~table` is a step Readability created (extract/index.ts livePath).
  const steps = seg.domPath.match(/^.*\/~?table\[\d+\]/);
  return steps?.[0] ?? '';
}

type States = JobView['segs'] | undefined;

/** Consecutive segments of one table, grouped into rows by groupId. */
function Table({ cells, states, actions }: { cells: Segment[]; states: States; actions?: SegmentActions | undefined }) {
  const rows: Segment[][] = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    if (row && row[0]?.groupId === c.groupId) row.push(c);
    else rows.push([c]);
  }
  return (
    <div class="seg-table" role="table">
      {rows.map((row) => (
        <div class="seg-row" role="row" key={row[0]?.id} data-group={row[0]?.groupId}>
          {row.map((c) => (
            <Cell key={c.id} seg={c} state={states?.get(c.id)} actions={actions} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SegmentList({ segments, states, actions }: { segments: readonly Segment[]; states?: States; actions?: SegmentActions }) {
  const out: ComponentChildren[] = [];
  for (let i = 0; i < segments.length; ) {
    const seg = segments[i] as Segment;
    const table = tableOf(seg);
    if (table !== undefined) {
      let j = i;
      while (j < segments.length && tableOf(segments[j] as Segment) === table) j++;
      out.push(<Table key={seg.id} cells={segments.slice(i, j)} states={states} actions={actions} />);
      i = j;
    } else {
      out.push(<Block key={seg.id} seg={seg} state={states?.get(seg.id)} actions={actions} />);
      i++;
    }
  }
  return <div class="segments">{out}</div>;
}
