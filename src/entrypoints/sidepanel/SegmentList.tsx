import { Component, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Segment } from '@/engine/types';
import type { JobView, SegState } from './jobs.ts';
import { markerKinds, parseMarkup, plainText, type MarkupNode } from './markup.ts';
import { failureText } from './status.ts';

/** Per-segment actions (M3-E8, M3-E5); absent for a list with nothing to act on. */
export interface SegmentActions {
  retry(id: string): void;
  /** This block again, skipping the cache (M3-E5). Absent: no Retranslate button. */
  retranslate?(id: string): void;
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

type Props = {
  seg: Segment;
  state: SegState | undefined;
  actions?: SegmentActions | undefined;
  /** The original is shown under the translation (Original, M3-E5). */
  original?: boolean;
  onOriginal?: ((id: string) => void) | undefined;
  /** The job's model: a final produced by another one (a fallback, M4-E9) gets a badge naming it. */
  model?: string | undefined;
};

const translated = (state: SegState | undefined): state is SegState & { text: string } => state?.status === 'final' && state.text !== undefined;

/** What Copy puts on the clipboard: the text the block shows, as plain text (no markers; code as is). */
export function copyText(seg: Segment, state: SegState | undefined): string {
  if (seg.kind === 'code' || !seg.translate) return seg.text;
  return plainText(parseMarkup(state?.text ?? seg.inlineMarkup, markerKinds(seg)));
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  throw new Error('no clipboard');
}

/**
 * Per-block actions (plan M3-E5, DESIGN §3): show the original inline, retranslate (skips the
 * cache), copy. Only on a finished block, so a block being redone can't be asked twice; a code
 * block, kept as is, has Copy only.
 */
/** The block's first few words, so a screen reader can tell one block's buttons from the next. */
export function blockName(seg: Segment): string {
  const words = seg.text.trim().split(/\s+/);
  return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
}

function BlockActions({ seg, state, actions, original, onOriginal }: Props) {
  const [copied, setCopied] = useState<'ok' | 'failed' | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const done = translated(state);
  if (!done && seg.kind !== 'code') return null;
  const name = blockName(seg);
  const copy = () => {
    writeClipboard(copyText(seg, state)).then(
      () => setCopied('ok'),
      () => setCopied('failed'),
    );
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(undefined), 1500);
  };
  return (
    <span class="seg__actions" role="group" aria-label={`Actions for "${name}"`}>
      {done && onOriginal ? (
        <button type="button" class="seg__action" data-testid="seg-original" aria-pressed={original === true} aria-label={`${original ? 'Hide original' : 'Show original'}: "${name}"`} onClick={() => onOriginal(seg.id)}>
          {original ? 'Hide original' : 'Original'}
        </button>
      ) : null}
      {done && actions?.retranslate ? (
        <button
          type="button"
          class="seg__action"
          data-testid="seg-retranslate"
          aria-label={`Retranslate: "${name}"`}
          title="Translate this block again, skipping the saved translation"
          onClick={() => actions.retranslate?.(seg.id)}
        >
          Retranslate
        </button>
      ) : null}
      <button type="button" class="seg__action" data-testid="seg-copy" aria-label={`Copy: "${name}"`} onClick={copy}>
        {copied === 'ok' ? 'Copied' : copied === 'failed' ? "Couldn't copy" : 'Copy'}
      </button>
    </span>
  );
}

/** The original under its translation, as text like the rest (§5.6). */
function Original({ seg, state, original }: Props) {
  if (!original || !translated(state)) return null;
  return (
    <span class="seg__original" data-testid="seg-original-text">
      <Markup nodes={parseMarkup(seg.inlineMarkup, markerKinds(seg))} />
    </span>
  );
}

function statusAttrs(seg: Segment, state: SegState | undefined, extra = '') {
  const status = seg.translate ? (state?.status ?? 'original') : 'kept';
  return {
    'data-id': seg.id,
    'data-kind': seg.kind,
    'data-status': status,
    class: `seg seg--${seg.kind} seg--${status}${seg.hidden ? ' seg--hidden' : ''}${extra}`,
  };
}

/**
 * A small badge naming the model that translated a block when it is not the job's (§4.3.5: "the
 * panel shows which model translated each block"): the primary was rate-limited or down and a
 * fallback profile took over (M4-E9).
 */
function ModelBadge({ state, model }: Props) {
  if (state?.status !== 'final' || state.model === undefined || model === undefined || model === '' || state.model === model) return null;
  return (
    <span class="seg__badge" data-testid="seg-model-badge" title={`Translated by ${state.model}, because ${model} was unavailable`} aria-label={`Translated by the fallback model ${state.model}`}>
      {state.model}
    </span>
  );
}

function Notes(props: Props) {
  const { seg, state, actions } = props;
  return (
    <>
      <ModelBadge {...props} />
      <Original {...props} />
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
      {state?.status === 'final' && state.redoError ? (
        <span class="seg__note seg__note--failed" role="note" data-testid="seg-redo-failed">
          Retranslate failed: {failureText(state.redoError)}. The earlier translation is kept.
        </span>
      ) : null}
      <BlockActions {...props} />
    </>
  );
}

/** Re-renders only when its segment's state object changes: a stream updates one block at a time. */
class Block extends Component<Props> {
  override shouldComponentUpdate(next: Props): boolean {
    return next.seg !== this.props.seg || next.state !== this.props.state || next.original !== this.props.original || next.model !== this.props.model;
  }

  override render(props: Props) {
    const { seg, state } = props;
    const common = statusAttrs(seg, state);
    switch (seg.kind) {
      case 'heading':
        return (
          <div {...common} role="heading" aria-level={seg.level ?? 2} data-level={seg.level ?? 2}>
            <Text seg={seg} state={state} />
            <Notes {...props} />
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
            <BlockActions {...props} />
          </figure>
        );
      case 'li':
        return (
          <div {...common} role="listitem">
            <Text seg={seg} state={state} />
            <Notes {...props} />
          </div>
        );
      case 'quote':
        return (
          <blockquote {...common}>
            <Text seg={seg} state={state} />
            <Notes {...props} />
          </blockquote>
        );
      default:
        return (
          <p {...common}>
            <Text seg={seg} state={state} />
            <Notes {...props} />
          </p>
        );
    }
  }
}

class Cell extends Component<Props> {
  override shouldComponentUpdate(next: Props): boolean {
    return next.seg !== this.props.seg || next.state !== this.props.state || next.original !== this.props.original || next.model !== this.props.model;
  }

  override render(props: Props) {
    const { seg, state } = props;
    const { class: cls, ...attrs } = statusAttrs(seg, state);
    return (
      <div {...attrs} class={cls.replace(`seg--${seg.kind}`, 'seg--table-cell')} role="cell">
        <Text seg={seg} state={state} />
        <Notes {...props} />
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
function Table({ cells, states, actions, originals, onOriginal, model }: { cells: Segment[]; states: States; actions?: SegmentActions | undefined; originals: ReadonlySet<string>; onOriginal?: ((id: string) => void) | undefined; model?: string | undefined }) {
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
            <Cell key={c.id} seg={c} state={states?.get(c.id)} actions={actions} original={originals.has(c.id)} onOriginal={onOriginal} model={model} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SegmentList({ segments, states, actions, model }: { segments: readonly Segment[]; states?: States; actions?: SegmentActions; model?: string }) {
  // Which blocks show their original (Original, M3-E5): per block, for as long as the list lives.
  const [originals, setOriginals] = useState<ReadonlySet<string>>(() => new Set());
  const onOriginal = useMemo(
    () => (id: string) =>
      setOriginals((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  // Only a translated list has originals to show.
  const toggle = states ? onOriginal : undefined;
  const out: ComponentChildren[] = [];
  for (let i = 0; i < segments.length; ) {
    const seg = segments[i] as Segment;
    const table = tableOf(seg);
    if (table !== undefined) {
      let j = i;
      while (j < segments.length && tableOf(segments[j] as Segment) === table) j++;
      out.push(<Table key={seg.id} cells={segments.slice(i, j)} states={states} actions={actions} originals={originals} onOriginal={toggle} model={model} />);
      i = j;
    } else {
      out.push(<Block key={seg.id} seg={seg} state={states?.get(seg.id)} actions={actions} original={originals.has(seg.id)} onOriginal={toggle} model={model} />);
      i++;
    }
  }
  return <div class="segments">{out}</div>;
}
