// Segment: the unit the content script extracts and the engine translates (DESIGN.md §4.1).
// Lives in engine/ so the engine can import it; the shell imports it from here.

export type SegmentKind = 'heading' | 'p' | 'li' | 'quote' | 'code' | 'table-cell' | 'caption';

export interface Segment {
  /** Stable across re-extraction of the same page: hash of `domPath` + `text`. */
  id: string;
  kind: SegmentKind;
  /** Plain text, whitespace-normalized. For `code`, the block's text verbatim (newlines kept). */
  text: string;
  /**
   * `text` with inline formatting as light markers the model can keep: `[link]…[/link]`,
   * backticks for inline code, `*…*` for emphasis. Equal to `text` when there is none, and for `code`.
   */
  inlineMarkup: string;
  /**
   * Where the block lives in the page: `/`-separated `tag[n]` steps (n = 1-based index among
   * same-tag siblings), with a `#shadow-root` step where the path enters an open shadow root.
   * A block made of loose inline content inside a container ends in `#run[k]`.
   */
  domPath: string;
  /** False for code blocks: kept as-is, never sent for translation (DESIGN.md §4.1). */
  translate: boolean;
  /** 1–6, for `heading`. */
  level?: number;
  /** Table cells of one row share it, so the chunker can keep a row together (ROADMAP §8 item 12). */
  groupId?: string;
  /** Language hint of a code block (`language-rust` → `rust`), when the page gives one. */
  codeLang?: string;
  /**
   * Not visible at extraction time: inside an inactive tab panel or a closed `details`.
   * Kept (ids must be stable) and translated when shown (decision S3).
   */
  hidden?: true;
}
