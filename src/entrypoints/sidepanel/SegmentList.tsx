import { Component, createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { checkSegment } from '@/engine/index';
import type { Segment } from '@/engine/types';
import { MAX_MEMORY_TEXT } from '@/shared/memory';
import type { JobView, SegState } from './jobs.ts';
import { markerKinds, parseMarkup, plainText, type MarkupNode } from './markup.ts';
import { i18n } from '#i18n';
import { failureText } from './status.ts';
import { blocksIn, handleBlockKey, rove } from './blocks-nav.ts';
import { isRtl } from '@/shared/language';
import type { Reading } from '@/shared/reading';

/** Per-segment actions (M3-E8, M3-E5); absent for a list with nothing to act on. */
export interface SegmentActions {
  retry(id: string): void;
  /** This block again, skipping the cache (M3-E5). Absent: no Retranslate button. */
  retranslate?(id: string): void;
  /** A short note on this block's idioms and cultural references (M5-E8). Absent: no Explain button. */
  explain?(id: string): void;
  /** Saves the user's correction of a finished block (the translation memory). Absent: no Edit button. */
  edit?(id: string, text: string): void;
  /** Retranslate on an edited block, once confirmed: its correction is replaced. */
  discardEdit?(id: string): void;
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
type Langs = { target?: string | undefined; source?: string | undefined; rtl?: boolean };
const Langs = createContext<Langs>({});

/** The translation if there is one, else the original; formatting only where the source has it (NB6). */
function Text({ seg, state }: { seg: Segment; state: SegState | undefined }) {
  const { target, source } = useContext(Langs);
  const src = state?.text ?? seg.inlineMarkup;
  const nodes = <Markup nodes={parseMarkup(src, markerKinds(seg))} />;
  if (state?.text !== undefined && target) return <span lang={target}>{nodes}</span>;
  // The original while a block waits: in its own language, so it is spoken and drawn as that.
  if (seg.translate && source) return <span lang={source}>{nodes}</span>;
  return nodes;
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
  /** The inline editor is open on this block. */
  editing?: boolean;
  /** This edited block's Retranslate asks "Replace your edit?". */
  confirming?: boolean;
};

/** The list's one open editor and one open confirmation, and the way to open and close them. */
interface ListUi {
  edit(id: string | undefined): void;
  confirm(id: string | undefined): void;
}
const Ui = createContext<ListUi>({ edit: () => undefined, confirm: () => undefined });

/** What an edit lost of the source's code spans, links, web addresses or numbers (checkSegment), as words. */
export function lostInEdit(source: string, text: string, targetLang: string): string[] {
  const lost = new Set<string>();
  for (const f of checkSegment(source, text, targetLang)) {
    if (f.kind === 'code') lost.add('panel.segment.editLostCode');
    else if (f.kind === 'url') lost.add('panel.segment.editLostUrls');
    else if (f.kind === 'number') lost.add('panel.segment.editLostNumbers');
    // The marker check names what it counts: links, or code spans and their backticks (emphasis is not reported).
    else if (f.kind === 'markers' && f.detail.includes('link')) lost.add('panel.segment.editLostLinks');
    else if (f.kind === 'markers' && /code|backtick/.test(f.detail)) lost.add('panel.segment.editLostCode');
  }
  return [...lost].map((key) => i18n.t(key as 'panel.segment.editLostCode'));
}

const translated = (state: SegState | undefined): state is SegState & { text: string } => state?.status === 'final' && state.text !== undefined;

/** What Copy puts on the clipboard: the text the block shows, as plain text (no markers; code as is). */
export function copyText(seg: Segment, state: SegState | undefined): string {
  if (seg.kind === 'code' || !seg.translate) return seg.text;
  return plainText(parseMarkup(state?.text ?? seg.inlineMarkup, markerKinds(seg)));
}

/** A toolbar button's tooltip: its name (icon buttons only; a text button shows its own) over what it does. */
function tip(description: string, name?: string) {
  return { 'data-name': name, 'data-tip': description, 'aria-description': description };
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

function BlockActions({ seg, state, actions, original, onOriginal, draft, onDraft, editing }: Props) {
  const ui = useContext(Ui);
  const [copied, setCopied] = useState<'ok' | 'failed' | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const done = translated(state);
  if ((!done && seg.kind !== 'code') || editing) return null;
  const name = blockName(seg);
  const copy = () => {
    writeClipboard(copyText(seg, state)).then(
      () => setCopied('ok'),
      () => setCopied('failed'),
    );
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(undefined), 1500);
  };
  // Icon buttons: the icon is a CSS mask and the name is aria-label. A state ("Copied", "Explain again") is also
  // said as hidden text and in the tooltip; with no state the button holds no text node (a toolbar per block adds up).
  // Each button's tooltip is drawn by CSS from data-name and data-tip; aria-description says the same to a screen reader.
  const explainText = i18n.t(state?.explain?.status === 'loading' ? 'panel.segment.explaining' : state?.explain ? 'panel.segment.explainAgain' : 'panel.segment.explain');
  const copyWord = i18n.t(copied === 'ok' ? 'panel.segment.copied' : copied === 'failed' ? 'panel.segment.copyFailed' : 'panel.segment.copy');
  return (
    <span class="seg__actions" role="group" aria-label={i18n.t('panel.segment.actionsFor', [name])}>
      {done && onOriginal ? (
        <button type="button" class="seg__action seg__action--text" data-testid="seg-original" aria-keyshortcuts="O" aria-pressed={original === true} aria-label={i18n.t(original ? 'panel.segment.hideOriginalFor' : 'panel.segment.showOriginalFor', [name])} {...tip(i18n.t(original ? 'panel.segment.hideOriginalTitle' : 'panel.segment.originalTitle'))} onClick={() => onOriginal(seg.id)}>
          {original ? i18n.t('panel.segment.hideOriginal') : i18n.t('panel.segment.original')}
        </button>
      ) : null}
      {done && state.draft !== undefined && onDraft ? (
        <button
          type="button"
          class="seg__action seg__action--text"
          data-testid="seg-draft"
          aria-pressed={draft === true}
          aria-label={i18n.t(draft ? 'panel.segment.hideDraftFor' : 'panel.segment.showDraftFor', [name])}
          {...tip(i18n.t('panel.segment.draftTitle', [state.reviewModel ?? '']))}
          onClick={() => onDraft(seg.id)}
        >
          {draft ? i18n.t('panel.segment.hideDraft') : i18n.t('panel.segment.showDraft')}
        </button>
      ) : null}
      {done && actions?.retranslate ? (
        <button
          type="button"
          class="seg__action seg__action--icon seg__action--retranslate"
          data-testid="seg-retranslate"
          aria-keyshortcuts="R"
          aria-label={i18n.t('panel.segment.retranslateFor', [name])}
          {...tip(i18n.t('panel.segment.retranslateTitle'), i18n.t('panel.segment.retranslate'))}
          // An edit is replaced only after the user confirms it.
          onClick={() => (state.edited && actions.discardEdit ? ui.confirm(seg.id) : actions.retranslate?.(seg.id))}
        >
        </button>
      ) : null}
      {done && seg.translate && actions?.edit ? (
        <button type="button" class="seg__action seg__action--icon seg__action--edit" data-testid="seg-edit" aria-label={i18n.t('panel.segment.editFor', [name])} {...tip(i18n.t('panel.segment.editTitle'), i18n.t('panel.segment.edit'))} onClick={() => ui.edit(seg.id)}>
        </button>
      ) : null}
      {done && actions?.explain ? (
        <button
          type="button"
          class="seg__action seg__action--icon seg__action--explain"
          data-testid="seg-explain"
          aria-keyshortcuts="E"
          aria-label={i18n.t('panel.segment.explainFor', [name])}
          {...tip(i18n.t('panel.segment.explainTitle'), explainText)}
          disabled={state?.explain?.status === 'loading'}
          onClick={() => actions.explain?.(seg.id)}
        >
          {state?.explain ? <span class="sr-only">{explainText}</span> : null}
        </button>
      ) : null}
      <button type="button" class={`seg__action seg__action--icon seg__action--${copied === 'ok' ? 'copied' : 'copy'}`} data-testid="seg-copy" aria-keyshortcuts="C" aria-label={i18n.t('panel.segment.copyFor', [name])} {...tip(i18n.t('panel.segment.copyTitle'), copyWord)} onClick={copy}>
        {copied ? <span class="sr-only">{copyWord}</span> : null}
      </button>
    </span>
  );
}

/** The original under its translation, as text like the rest (§5.6). */
function Original({ seg, state, original }: Props) {
  const { source } = useContext(Langs);
  if (!original || !translated(state)) return null;
  return (
    <span class="seg__original" data-testid="seg-original-text" {...(source ? { lang: source, dir: isRtl(source) ? 'rtl' : 'ltr' } : {})}>
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
  return (
    <span class="seg__marker seg__refined" data-testid="seg-refined" role="img" aria-label={i18n.t('panel.segment.refined')} title={i18n.t('panel.segment.refinedTitle')}>
      <span aria-hidden="true">{i18n.t('panel.segment.refined')}</span>
    </span>
  );
}

/** A small label after a block that shows a correction: the user's ("edited") or an imported one. */
function EditedMark({ state }: Props) {
  if (state?.status !== 'final' || !state.edited) return null;
  const imported = state.edited === 'import';
  return (
    <>
      <span class={`seg__badge seg__badge--edited${imported ? ' seg__badge--imported' : ''}`} data-testid={imported ? 'seg-imported' : 'seg-edited'} title={i18n.t(imported ? 'panel.segment.importedTitle' : 'panel.segment.editedTitle')}>
        {i18n.t(imported ? 'panel.segment.imported' : 'panel.segment.edited')}
      </span>
      {state.editUnsaved ? (
        <span class="seg__note seg__note--failed" role="note" data-testid="seg-edit-unsaved">
          {i18n.t('panel.segment.editUnsaved')}
        </span>
      ) : null}
    </>
  );
}

/**
 * The inline editor of a finished block: the shown text, light markers included, in a labelled
 * text field. Ctrl/Cmd+Enter or Save saves, Esc or Cancel closes; focus then goes back to the block.
 * A text that lost the source's code spans, links or numbers is warned about, and can still be saved.
 */
function Editor({ seg, state, actions }: Props) {
  const ui = useContext(Ui);
  const { target } = useContext(Langs);
  const [text, setText] = useState(state?.text ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const lost = useMemo(() => lostInEdit(seg.inlineMarkup, text, target ?? ''), [seg, text, target]);
  const empty = text.trim() === '';
  const save = () => {
    if (empty) return;
    actions?.edit?.(seg.id, text);
    ui.edit(undefined);
  };
  const id = `seg-edit-${seg.id}`;
  return (
    <span class="seg__editor" data-testid="seg-editor">
      <textarea
        id={id}
        ref={area}
        class="seg__edit-text"
        data-testid="seg-edit-text"
        aria-label={i18n.t('panel.segment.editLabel', [blockName(seg)])}
        aria-describedby={`${id}-hint${lost.length > 0 ? ` ${id}-warn` : ''}`}
        {...(target ? { lang: target } : {})}
        rows={Math.min(10, Math.max(2, Math.ceil(text.length / 60)))}
        maxLength={MAX_MEMORY_TEXT}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            ui.edit(undefined);
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <span class="seg__edit-hint" id={`${id}-hint`}>
        {i18n.t('panel.segment.editHint')}
      </span>
      <span class="seg__note seg__note--warn" id={`${id}-warn`} role="status" data-testid="seg-edit-warning">
        {lost.length > 0 ? i18n.t('panel.segment.editWarning', [lost.join(', ')]) : ''}
      </span>
      <span class="seg__edit-buttons">
        <button type="button" class="seg__action" data-testid="seg-edit-save" disabled={empty} onClick={save}>
          {i18n.t('panel.segment.editSave')}
        </button>
        <button type="button" class="seg__action" data-testid="seg-edit-cancel" onClick={() => ui.edit(undefined)}>
          {i18n.t('panel.segment.editCancel')}
        </button>
      </span>
    </span>
  );
}

/** "Replace your edit?" before an edited block's Retranslate. "Keep it" has the focus; Esc keeps it too. */
function ReplaceEdit({ seg, state, actions, confirming }: Props) {
  const ui = useContext(Ui);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  if (!confirming || state?.status !== 'final' || !state.edited) return null;
  const id = `seg-replace-${seg.id}`;
  return (
    <span
      class="seg__confirm"
      role="alertdialog"
      aria-labelledby={`${id}-q`}
      aria-describedby={`${id}-d`}
      data-testid="seg-replace-confirm"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        ui.confirm(undefined);
      }}
    >
      <strong id={`${id}-q`}>{i18n.t(state.edited === 'import' ? 'panel.segment.replaceImported' : 'panel.segment.replaceEdit')}</strong> <span id={`${id}-d`}>{i18n.t('panel.segment.replaceText')}</span>{' '}
      <button
        type="button"
        class="seg__action"
        data-testid="seg-replace-yes"
        onClick={() => {
          ui.confirm(undefined);
          actions?.discardEdit?.(seg.id);
        }}
      >
        {i18n.t('panel.segment.replaceYes')}
      </button>
      <button type="button" class="seg__action" ref={keep} data-testid="seg-replace-no" onClick={() => ui.confirm(undefined)}>
        {i18n.t('panel.segment.replaceNo')}
      </button>
    </span>
  );
}

/**
 * A block's language and direction. A block showing a translation carries the target `lang` itself,
 * so `text-align: start` and logical padding mirror for Arabic or Hebrew; any other block runs in its
 * source's direction, stated when the list around it runs the other way.
 */
function langAttrs(seg: Segment, state: SegState | undefined, langs: { target?: string | undefined; source?: string | undefined; rtl?: boolean }): { lang?: string; dir?: 'rtl' | 'ltr' | 'auto' } {
  if (seg.translate && state?.text !== undefined && langs.target) return { lang: langs.target, ...(isRtl(langs.target) ? { dir: 'rtl' } : {}) };
  if (isRtl(langs.source)) return { dir: 'rtl' };
  // Inside a right-to-left list: left to right for a known source, the text's own direction otherwise.
  return langs.rtl ? { dir: langs.source ? 'ltr' : 'auto' } : {};
}

function statusAttrs(seg: Segment, state: SegState | undefined, extra = '') {
  const status = seg.translate ? (state?.status ?? 'original') : 'kept';
  const refined = status === 'final' && state?.refined === true;
  const edited = status === 'final' ? state?.edited : undefined;
  return {
    'data-id': seg.id,
    'data-kind': seg.kind,
    'data-status': status,
    ...(refined ? { 'data-refined': 'true' } : {}),
    ...(edited ? { 'data-edited': edited } : {}),
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
      <EditedMark {...props} />
      <ModelBadge {...props} />
      <Draft {...props} />
      <Original {...props} />
      {seg.hidden ? <span class="seg__note">{i18n.t('panel.segment.hidden')}</span> : null}
      {state?.status === 'failed' && state.error ? (
        // A note, not an alert: a page with many failed blocks would otherwise interrupt for each one.
        <span class="ui-notice ui-notice--danger seg__failed" role="note">
          <span>{i18n.t('panel.segment.failed', [failureText(state.error)])}</span>
          {actions && state.error.kind !== 'auth' ? (
            <button type="button" class="ui-button seg__retry" data-testid="segment-retry" onClick={() => actions.retry(seg.id)}>
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
      <ReplaceEdit {...props} />
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

const changed = (a: Props, b: Props) => a.seg !== b.seg || a.state !== b.state || a.original !== b.original || a.draft !== b.draft || a.model !== b.model || a.editing !== b.editing || a.confirming !== b.confirming;

/** The block's text, or its editor while that is open. */
function Shown(props: Props) {
  if (props.editing && translated(props.state)) return <Editor {...props} />;
  return (
    <>
      <Text seg={props.seg} state={props.state} />
      {/* A block still streaming ends in a still caret (no blinking). */}
      {props.state?.status === 'streaming' ? <span class="seg__caret" aria-hidden="true" /> : null}
    </>
  );
}

/** Re-renders only when its segment's state object changes: a stream updates one block at a time. */
class Block extends Component<Props> {
  static override contextType = Langs;

  override shouldComponentUpdate(next: Props): boolean {
    return changed(this.props, next);
  }

  override render(props: Props) {
    const { seg, state } = props;
    const common = { ...statusAttrs(seg, state), ...langAttrs(seg, state, this.context as Langs) };
    switch (seg.kind) {
      case 'heading':
        return (
          <div {...common} role="heading" aria-level={seg.level ?? 2} data-level={seg.level ?? 2}>
            <Shown {...props} />
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
            <Shown {...props} />
            <Notes {...props} />
          </div>
        );
      case 'quote':
        return (
          <blockquote {...common}>
            <Shown {...props} />
            <Notes {...props} />
          </blockquote>
        );
      default:
        return (
          <p {...common}>
            {seg.alt ? <span class="seg__label seg__label--image">{i18n.t('panel.segment.image')} · </span> : null}
            <Shown {...props} />
            <Notes {...props} />
          </p>
        );
    }
  }
}

class Cell extends Component<Props> {
  static override contextType = Langs;

  override shouldComponentUpdate(next: Props): boolean {
    return changed(this.props, next);
  }

  override render(props: Props) {
    const { seg, state } = props;
    const { class: cls, ...attrs } = { ...statusAttrs(seg, state), ...langAttrs(seg, state, this.context as Langs) };
    return (
      <div {...attrs} class={cls.replace(`seg--${seg.kind}`, 'seg--table-cell')} role="cell">
        <Shown {...props} />
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
function Table({ cells, states, actions, originals, onOriginal, drafts, onDraft, model, editing, confirming }: { cells: Segment[]; states: States; actions?: SegmentActions | undefined; originals: ReadonlySet<string>; onOriginal?: ((id: string) => void) | undefined; drafts: ReadonlySet<string>; onDraft?: ((id: string) => void) | undefined; model?: string | undefined; editing: string | undefined; confirming: string | undefined }) {
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
            <Cell key={c.id} seg={c} state={states?.get(c.id)} actions={actions} original={originals.has(c.id)} onOriginal={onOriginal} draft={drafts.has(c.id)} onDraft={onDraft} model={model} editing={editing === c.id} confirming={confirming === c.id} />
          ))}
        </div>
      ))}
    </div>
  );
}

const MEASURE: Record<Reading['width'], string> = { narrow: '34em', medium: '40em', full: 'none' };

export function SegmentList({ segments, states, actions, model, targetLang, sourceLang, busy, reading }: { segments: readonly Segment[]; states?: States; actions?: SegmentActions; model?: string; targetLang?: string; sourceLang?: string; busy?: boolean; reading?: Reading | undefined }) {
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
  // One editor and one "Replace your edit?" at a time; when either closes, focus goes back to its block.
  const [editing, setEditing] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<string | undefined>();
  const returnTo = useRef<string | undefined>(undefined);
  const ui = useMemo<ListUi>(() => {
    const open = (set: (id: string | undefined) => void, current: () => string | undefined) => (id: string | undefined) => {
      if (id === undefined) returnTo.current = current();
      set(id);
    };
    let edit: string | undefined;
    let confirm: string | undefined;
    return {
      edit: open((id) => setEditing((edit = id)), () => edit),
      confirm: open((id) => setConfirming((confirm = id)), () => confirm),
    };
  }, []);
  // A block that stops being final (a retranslate, a new run) closes its editor and its question.
  const editingState = editing === undefined ? undefined : states?.get(editing);
  const confirmingState = confirming === undefined ? undefined : states?.get(confirming);
  useEffect(() => {
    if (editing !== undefined && editingState?.status !== 'final') ui.edit(undefined);
    if (confirming !== undefined && (confirmingState?.status !== 'final' || !confirmingState.edited)) ui.confirm(undefined);
  }, [editingState, confirmingState]);
  useEffect(() => {
    const id = returnTo.current;
    if (id === undefined || !root.current) return;
    returnTo.current = undefined;
    const block = blocksIn(root.current).find((b) => b.dataset.id === id);
    if (!block) return;
    rove(root.current, block);
    block.focus({ preventScroll: true });
  }, [editing, confirming]);
  // A list translated into Arabic or Hebrew runs right to left.
  const rtl = states !== undefined && isRtl(targetLang);
  const langs = useMemo(() => ({ target: targetLang, source: sourceLang, rtl }), [targetLang, sourceLang, rtl]);
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
      out.push(<Table key={seg.id} cells={segments.slice(i, j)} states={states} actions={actions} originals={originals} onOriginal={toggle} drafts={drafts} onDraft={toggleDraft} model={model} editing={editing} confirming={confirming} />);
      i = j;
    } else if (seg.kind === 'li') {
      // List items sit in a list, so a screen reader announces "list, 3 items".
      let j = i;
      while (j < segments.length && (segments[j] as Segment).kind === 'li' && tableOf(segments[j] as Segment) === undefined) j++;
      out.push(
        <div class="seg-list" role="list" key={seg.id}>
          {segments.slice(i, j).map((li) => (
            <Block key={li.id} seg={li} state={states?.get(li.id)} actions={actions} original={originals.has(li.id)} onOriginal={toggle} draft={drafts.has(li.id)} onDraft={toggleDraft} model={model} editing={editing === li.id} confirming={confirming === li.id} />
          ))}
        </div>,
      );
      i = j;
    } else {
      out.push(<Block key={seg.id} seg={seg} state={states?.get(seg.id)} actions={actions} original={originals.has(seg.id)} onOriginal={toggle} draft={drafts.has(seg.id)} onDraft={toggleDraft} model={model} editing={editing === seg.id} confirming={confirming === seg.id} />);
      i++;
    }
  }
  return (
    <Langs.Provider value={langs}>
      <Ui.Provider value={ui}>
      <div
        class="segments"
        ref={root}
        role="region"
        aria-label={i18n.t('panel.segment.region')}
        aria-busy={busy === true}
        {...(rtl ? { dir: 'rtl' } : {})}
        // The reading settings: typeface, size and line width apply here, through CSS only (no block re-renders, no job).
        data-typeface={reading?.typeface ?? 'sans'}
        style={{ '--reading-size': `${reading?.size ?? 16}px`, '--reading-measure': MEASURE[reading?.width ?? 'medium'], '--waiting-label': JSON.stringify(i18n.t('panel.segment.waiting')) }} onKeyDown={(e) => root.current && handleBlockKey(e, root.current)} onFocusIn={(e) => root.current && rove(root.current, (e.target as Element).closest<HTMLElement>('[data-id]') ?? undefined)}>
          {out}
        </div>
      </Ui.Provider>
    </Langs.Provider>
  );
}
