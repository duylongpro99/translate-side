import { Component, createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Segment } from '@/engine/types';
import type { JobView, SegState } from './jobs.ts';
import { markerKinds, parseMarkup, plainText, type MarkupNode } from './markup.ts';
import { i18n } from '#i18n';
import { failureText } from './status.ts';
import { handleBlockKey, rove } from './blocks-nav.ts';

/** Per-segment actions (M3-E8, M3-E5); absent for a list with nothing to act on. */
export interface SegmentActions {
  retry(id: string): void;
  /** This block again, skipping the cache (M3-E5). Absent: no Retranslate button. */
  retranslate?(id: string): void;
  /** A short note on this block's idioms and cultural references (M5-E8). Absent: no Explain button. */
  explain?(id: string): void;
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

/** The job's languages, so a screen reader speaks the translation in the target language and the original in the source's. */
const Langs = createContext<{ target?: string | undefined; source?: string | undefined }>({});

/** The translation if there is one, else the original; formatting only where the source has it (NB6). */
function Text({ seg, state }: { seg: Segment; state: SegState | undefined }) {
  const { target } = useContext(Langs);
  const src = state?.text ?? seg.inlineMarkup;
  const nodes = <Markup nodes={parseMarkup(src, markerKinds(seg))} />;
  return state?.text !== undefined && target ? <span lang={target}>{nodes}</span> : nodes;
}

type Props = {
  seg: Segment;
  state: SegState | undefined;
  actions?: SegmentActions | undefined;
  /** The original is shown under the translation (Original, M3-E5). */
  original?: boolean;
  onOriginal?: ((id: string) => void) | undefined;
  /** Best: the draft a review replaced is shown under the refined text (Show draft). */
  draft?: boolean;
  onDraft?: ((id: string) => void) | undefined;
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

function BlockActions({ seg, state, actions, original, onOriginal, draft, onDraft }: Props) {
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
    <span class="seg__actions" role="group" aria-label={i18n.t('panel.segment.actionsFor', [name])}>
      {done && onOriginal ? (
        <button type="button" class="seg__action" data-testid="seg-original" aria-keyshortcuts="O" aria-pressed={original === true} aria-label={i18n.t(original ? 'panel.segment.hideOriginalFor' : 'panel.segment.showOriginalFor', [name])} onClick={() => onOriginal(seg.id)}>
          {original ? i18n.t('panel.segment.hideOriginal') : i18n.t('panel.segment.original')}
        </button>
      ) : null}
      {done && state.draft !== undefined && onDraft ? (
        <button
          type="button"
          class="seg__action"
          data-testid="seg-draft"
          aria-pressed={draft === true}
          aria-label={i18n.t(draft ? 'panel.segment.hideDraftFor' : 'panel.segment.showDraftFor', [name])}
          title={i18n.t('panel.segment.draftTitle', [state.reviewModel ?? ''])}
          onClick={() => onDraft(seg.id)}
        >
          {draft ? i18n.t('panel.segment.hideDraft') : i18n.t('panel.segment.showDraft')}
        </button>
      ) : null}
      {done && actions?.retranslate ? (
        <button
          type="button"
          class="seg__action"
          data-testid="seg-retranslate"
          aria-keyshortcuts="R"
          aria-label={i18n.t('panel.segment.retranslateFor', [name])}
          title={i18n.t('panel.segment.retranslateTitle')}
          onClick={() => actions.retranslate?.(seg.id)}
        >
          {i18n.t('panel.segment.retranslate')}
        </button>
      ) : null}
      {done && actions?.explain ? (
        <button
          type="button"
          class="seg__action"
          data-testid="seg-explain"
          aria-keyshortcuts="E"
          aria-label={i18n.t('panel.segment.explainFor', [name])}
          title={i18n.t('panel.segment.explainTitle')}
          disabled={state?.explain?.status === 'loading'}
          onClick={() => actions.explain?.(seg.id)}
        >
          {i18n.t(state?.explain?.status === 'loading' ? 'panel.segment.explaining' : state?.explain ? 'panel.segment.explainAgain' : 'panel.segment.explain')}
        </button>
      ) : null}
      <button type="button" class="seg__action" data-testid="seg-copy" aria-keyshortcuts="C" aria-label={i18n.t('panel.segment.copyFor', [name])} onClick={copy}>
        {i18n.t(copied === 'ok' ? 'panel.segment.copied' : copied === 'failed' ? 'panel.segment.copyFailed' : 'panel.segment.copy')}
      </button>
    </span>
  );
}

/** The original under its translation, as text like the rest (§5.6). */
function Original({ seg, state, original }: Props) {
  const { source } = useContext(Langs);
  if (!original || !translated(state)) return null;
  return (
    <span class="seg__original" data-testid="seg-original-text" {...(source ? { lang: source } : {})}>
      <Markup nodes={parseMarkup(seg.inlineMarkup, markerKinds(seg))} />
    </span>
  );
}

/** The draft a review replaced, under the refined text, in the target language (Show draft). */
function Draft({ seg, state, draft }: Props) {
  const { target } = useContext(Langs);
  if (!draft || state?.status !== 'final' || state.draft === undefined) return null;
  return (
    <span class="seg__draft" data-testid="seg-draft-text" {...(target ? { lang: target } : {})}>
      <Markup nodes={parseMarkup(state.draft, markerKinds(seg))} />
    </span>
  );
}

/** Best: a small dot after a block whose text is the review's revision (DESIGN.md §5.2 "refined"). */
function RefinedMark({ state }: Props) {
  if (state?.status !== 'final' || !state.refined) return null;
  return <span class="seg__refined" data-testid="seg-refined" role="img" aria-label={i18n.t('panel.segment.refined')} title={i18n.t('panel.segment.refinedTitle')} />;
}

function statusAttrs(seg: Segment, state: SegState | undefined, extra = '') {
  const status = seg.translate ? (state?.status ?? 'original') : 'kept';
  const refined = status === 'final' && state?.refined === true;
  return {
    'data-id': seg.id,
    'data-kind': seg.kind,
    'data-status': status,
    ...(refined ? { 'data-refined': 'true' } : {}),
    // Focusable for the keyboard (src/entrypoints/sidepanel/blocks-nav.ts roves the one Tab stop); a block still arriving says so.
    tabIndex: -1,
    ...(status === 'streaming' || status === 'pending' ? { 'aria-busy': true } : {}),
    class: `seg seg--${seg.kind} seg--${status}${refined ? ' seg--refined' : ''}${seg.hidden ? ' seg--hidden' : ''}${extra}`,
  };
}

/**
 * A small badge naming the model that translated a block when it is not the job's (§4.3.5: "the
 * panel shows which model translated each block"): the primary was rate-limited or down and a
 * fallback profile took over (M4-E9).
 */
function ModelBadge({ state, model }: Props) {
  // Every provider was down and Chrome's Translator translated the block (M5-E7, DESIGN §9).
  if (state?.status === 'final' && state.basic) {
    return (
      <span class="seg__badge seg__badge--basic" data-testid="seg-basic-badge" title={i18n.t('panel.segment.basicTitle', [state.model ?? i18n.t('panel.segment.chromeTranslator')])}>
        {i18n.t('panel.segment.basic')}
      </span>
    );
  }
  if (state?.status !== 'final' || state.model === undefined || model === undefined || model === '' || state.model === model) return null;
  return (
    <span class="seg__badge" data-testid="seg-model-badge" title={i18n.t('panel.segment.fallbackTitle', [state.model, model])} aria-label={i18n.t('panel.segment.fallbackLabel', [state.model])}>
      {state.model}
    </span>
  );
}

function Notes(props: Props) {
  const { seg, state, actions } = props;
  return (
    <>
      <RefinedMark {...props} />
      <ModelBadge {...props} />
      <Draft {...props} />
      <Original {...props} />
      {seg.hidden ? <span class="seg__note">{i18n.t('panel.segment.hidden')}</span> : null}
      {state?.status === 'failed' && state.error ? (
        <span class="seg__note seg__note--failed" role="note">
          {i18n.t('panel.segment.failed', [failureText(state.error)])}
          {actions && state.error.kind !== 'auth' ? (
            <button type="button" class="seg__retry" data-testid="segment-retry" onClick={() => actions.retry(seg.id)}>
              {i18n.t('panel.segment.retry')}
            </button>
          ) : null}
        </span>
      ) : null}
      {state?.status === 'final' && state.redoError ? (
        <span class="seg__note seg__note--failed" role="note" data-testid="seg-redo-failed">
          {i18n.t('panel.segment.redoFailed', [failureText(state.redoError)])}
        </span>
      ) : null}
      <ExplainNote {...props} />
      <BlockActions {...props} />
    </>
  );
}

/** The "Explain this" note under a block: plain text, never HTML (§5.6, §8), on a failure the reason. */
function ExplainNote({ state }: Props) {
  const explain = state?.status === 'final' ? state.explain : undefined;
  if (!explain) return null;
  if (explain.status === 'failed') {
    return (
      <span class="seg__note seg__note--failed" role="note" data-testid="seg-explain-failed">
        {i18n.t('panel.segment.explainFailed', [explain.error ? failureText(explain.error) : i18n.t('panel.segment.itFailed')])}
      </span>
    );
  }
  if (explain.status === 'loading' && !explain.text) return null;
  const ready = explain.status === 'ready';
  return (
    <>
      {/* Hidden from screen readers (it would be read delta by delta); the status region below says it once, when whole. */}
      <span class="seg__explain" role="note" data-testid="seg-explain-note" aria-hidden="true">
        <span class="seg__explain-label">{i18n.t('panel.segment.explanation')}</span> {explain.text}
      </span>
      <span class="sr-only" role="status" data-testid="seg-explain-status">
        {ready ? i18n.t('panel.segment.explanationSr', [explain.text ?? '']) : ''}
      </span>
    </>
  );
}

/** Re-renders only when its segment's state object changes: a stream updates one block at a time. */
class Block extends Component<Props> {
  override shouldComponentUpdate(next: Props): boolean {
    return next.seg !== this.props.seg || next.state !== this.props.state || next.original !== this.props.original || next.draft !== this.props.draft || next.model !== this.props.model;
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
              {seg.codeLang ? `${seg.codeLang} · ` : ''}
              {i18n.t('panel.segment.codeKept')}
              {seg.hidden ? ` · ${i18n.t('panel.segment.hiddenShort')}` : ''}
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
            {seg.alt ? <span class="seg__label seg__label--image">{i18n.t('panel.segment.image')} · </span> : null}
            <Text seg={seg} state={state} />
            <Notes {...props} />
          </p>
        );
    }
  }
}

class Cell extends Component<Props> {
  override shouldComponentUpdate(next: Props): boolean {
    return next.seg !== this.props.seg || next.state !== this.props.state || next.original !== this.props.original || next.draft !== this.props.draft || next.model !== this.props.model;
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
function Table({ cells, states, actions, originals, onOriginal, drafts, onDraft, model }: { cells: Segment[]; states: States; actions?: SegmentActions | undefined; originals: ReadonlySet<string>; onOriginal?: ((id: string) => void) | undefined; drafts: ReadonlySet<string>; onDraft?: ((id: string) => void) | undefined; model?: string | undefined }) {
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
            <Cell key={c.id} seg={c} state={states?.get(c.id)} actions={actions} original={originals.has(c.id)} onOriginal={onOriginal} draft={drafts.has(c.id)} onDraft={onDraft} model={model} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SegmentList({ segments, states, actions, model, targetLang, sourceLang, busy }: { segments: readonly Segment[]; states?: States; actions?: SegmentActions; model?: string; targetLang?: string; sourceLang?: string; busy?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  // One Tab stop for the list, whatever re-rendered (a block that arrived, a button that appeared).
  useEffect(() => {
    if (root.current) rove(root.current);
  });
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
  // Which refined blocks show their draft (Show draft): likewise, for the session.
  const [drafts, setDrafts] = useState<ReadonlySet<string>>(() => new Set());
  const onDraft = useMemo(
    () => (id: string) =>
      setDrafts((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  // Only a translated list has originals (and drafts) to show.
  const toggle = states ? onOriginal : undefined;
  const toggleDraft = states ? onDraft : undefined;
  const out: ComponentChildren[] = [];
  for (let i = 0; i < segments.length; ) {
    const seg = segments[i] as Segment;
    const table = tableOf(seg);
    if (table !== undefined) {
      let j = i;
      while (j < segments.length && tableOf(segments[j] as Segment) === table) j++;
      out.push(<Table key={seg.id} cells={segments.slice(i, j)} states={states} actions={actions} originals={originals} onOriginal={toggle} drafts={drafts} onDraft={toggleDraft} model={model} />);
      i = j;
    } else if (seg.kind === 'li') {
      // List items sit in a list, so a screen reader announces "list, 3 items".
      let j = i;
      while (j < segments.length && (segments[j] as Segment).kind === 'li' && tableOf(segments[j] as Segment) === undefined) j++;
      out.push(
        <div class="seg-list" role="list" key={seg.id}>
          {segments.slice(i, j).map((li) => (
            <Block key={li.id} seg={li} state={states?.get(li.id)} actions={actions} original={originals.has(li.id)} onOriginal={toggle} draft={drafts.has(li.id)} onDraft={toggleDraft} model={model} />
          ))}
        </div>,
      );
      i = j;
    } else {
      out.push(<Block key={seg.id} seg={seg} state={states?.get(seg.id)} actions={actions} original={originals.has(seg.id)} onOriginal={toggle} draft={drafts.has(seg.id)} onDraft={toggleDraft} model={model} />);
      i++;
    }
  }
  return (
    <Langs.Provider value={{ target: targetLang, source: sourceLang }}>
      <div class="segments" ref={root} role="region" aria-label={i18n.t('panel.segment.region')} aria-busy={busy === true} onKeyDown={(e) => root.current && handleBlockKey(e, root.current)} onFocusIn={(e) => root.current && rove(root.current, (e.target as Element).closest<HTMLElement>('[data-id]') ?? undefined)}>
        {out}
      </div>
    </Langs.Provider>
  );
}
