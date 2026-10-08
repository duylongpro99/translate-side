// Segment: the unit the content script extracts and the engine translates (DESIGN.md §4.1).
// Lives in engine/ so the engine can import it; the shell imports it from here.
// Also the engine contract (§5.2–§5.6), below.

import type { LLMClient, LLMError, ModelRole } from '../llm/types.ts';

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
  /** False for code blocks (kept as-is, DESIGN.md §4.1) and for table cells with no letters or digits. */
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

// ---- Engine contract (DESIGN.md §5.2–§5.6) ----------------------------------------------------

export type StrategyId = 'basic' | 'single-pass' | 'contextual' | 'refine' | (string & {});

export interface GlossaryEntry {
  term: string;
  rendering: string;
  note?: string;
}

export interface DocMeta {
  url: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  /** Headings, for analysis. */
  outline: string[];
}

export type StyleMode = 'natural' | 'faithful' | 'simplified';

/**
 * Term glosses (plan M2 §5, decision M2-D1): `first` = a short gloss in parentheses at a term's
 * first occurrence in the document only, for glossary terms and terms with no common equivalent;
 * `off` = never.
 */
export type GlossMode = 'first' | 'off';

export interface JobOptions {
  style: StyleMode;
  /** The user's personal glossary (settings). It takes priority over the brief's terms. */
  glossary: GlossaryEntry[];
  /** Absent = `first` (DEFAULT_GLOSS). Prompts before `translate@2` ignore it. */
  gloss?: GlossMode;
  /** Parallel chunk requests: the profile's `maxConcurrency` (§4.3.1). The engine owns chunking (plan M1 §5). */
  maxConcurrency: number;
  /** Target chunk size in source tokens: the profile's `chunkTokens` (§4.3.1). */
  chunkTokens: number;
  /** Token and time ceiling for this job (§5.6). No limit when absent. */
  budget?: BudgetLimits;
  /**
   * A brief already made for this document (e.g. kept from an earlier run of the same page, or the
   * M3 brief cache). It seeds working memory and the analyze stage makes no call.
   */
  brief?: DocumentBrief;
}

export interface TranslationJob {
  doc: DocMeta & {
    /** From the content script (§4.1). */
    segments: Segment[];
  };
  /** Segment ids to do first (viewport), in page order. */
  priority: string[];
  /**
   * The viewport now (plan M3-E1): read each time a chunk is about to start, so a scroll moves
   * what is translated next. Pending chunks are reordered; chunks in flight are never aborted
   * (M3-D3). Absent: `priority` for the whole job. A plain function, so the engine stays free of
   * chrome.* and the DOM (§5.1).
   */
  livePriority?: () => readonly string[];
  strategy: StrategyId;
  options: JobOptions;
}

/**
 * Ad-hoc: one selection / one block (selection mode, "retranslate", "explain"). Provisional:
 * DESIGN.md doesn't define it yet; selection mode is M3.
 */
export interface SnippetRequest {
  doc: DocMeta;
  segments: Segment[];
  /** Default `single-pass`. */
  strategy?: StrategyId;
  options: JobOptions;
}

export type EngineEvent =
  | { type: 'stage'; stage: string; status: 'start' | 'done'; info?: unknown }
  /** Streaming preview. */
  | { type: 'segment.partial'; id: string; text: string }
  | {
      type: 'segment.final';
      id: string;
      text: string;
      revision: number;
      producedBy: { strategy: string; stage: string; model: string };
      /**
       * Absent = 1. A repair (decision S2, M1-E3) re-emits the same revision with a higher attempt,
       * and the panel replaces that revision's text. Revisions stay for later stages (refine = 2).
       */
      attempt?: number;
      /** E.g. an idiom explained. */
      notes?: string[];
    }
  | {
      type: 'segment.failed';
      id: string;
      error: LLMError;
      /**
       * The revision this failure is about. Absent: the pass that failed had no text shown yet or
       * was a revision-1 pass, and a higher revision already shown stays (§5.6). Present (the check
       * stage, Phase D): the failure condemns that revision's shown text, which is replaced by the
       * failure (review D-B1: a revision 2 that failed its checks twice is not a good revision).
       */
      revision?: number;
    }
  /**
   * Contextual only: a chunk's prompt is about to be built, with or without the brief (plan M2-D6,
   * ChunkOutcome.briefed). For the harness and diagnostics; the panel ignores it.
   * With `revise`: contextual's second pass of the chunk (M2-D17) is over, and `kept` lists the
   * segments whose revision 2 was dropped because it failed a post-check revision 1 passed (round 15, Phase D).
   */
  | { type: 'chunk'; index: number; briefed: boolean; revise?: { kept: string[] } }
  /** Shown in UI, cached. */
  | { type: 'artifact'; kind: 'brief' | 'glossary'; data: unknown }
  /** `input` includes cached tokens; `cachedInput` is how many were cache reads (plan M1 §5). */
  | { type: 'usage'; role: string; model: string; input: number; output: number; cachedInput?: number }
  | { type: 'done' };

export type EngineEventType = EngineEvent['type'];

export interface TranslationEngine {
  translate(job: TranslationJob, signal: AbortSignal): AsyncIterable<EngineEvent>;
  translateSnippet(req: SnippetRequest, signal: AbortSignal): AsyncIterable<EngineEvent>;
}

export type StageScope = 'document' | 'chunk' | 'segment';

/**
 * One step of a strategy (§5.3). `run` yields engine events and output values; the runner
 * (runner.ts) tells them apart by `type`, so an output value must not be an object whose `type`
 * is an EngineEvent type.
 */
export interface Stage<I, O> {
  /** "analyze", "translate", "review", "check". */
  id: string;
  scope: StageScope;
  /** Which model role it uses, if any. */
  role?: ModelRole;
  /** "translate@3". */
  promptId?: string;
  run(input: I, ctx: StageContext): AsyncIterable<EngineEvent | O>;
  /**
   * `chunk` and `segment` stages: which pending element starts next when a slot frees (index into
   * `items`, one of `pending`). Absent: element order. Only the start order changes; elements in
   * flight are never touched.
   */
  pick?(items: readonly I[], pending: readonly number[], ctx: StageContext): number;
}

export interface StageContext {
  /** A client for the role, already wrapped by the pipeline's retry policy (retry.ts). */
  llm: (role: ModelRole) => LLMClient;
  /** Brief, glossary decisions, translated-so-far, term usage. */
  memory: WorkingMemory;
  /** Pluggable knowledge (§5.4). */
  context: ContextProvider[];
  prompts: PromptRegistry;
  /** Token/time limits for this job. */
  budget: Budget;
  signal: AbortSignal;
  /** Segment ids to do first, as of now (the job's `livePriority`, else its `priority`). Absent: none. */
  priority?: () => readonly string[];
}

export interface Strategy {
  id: StrategyId;
  /** Part of the cache key. */
  version: number;
  run(job: TranslationJob, ctx: StageContext): AsyncIterable<EngineEvent>;
}

/** The analyze stage's output (§5.7 step 1). */
export interface DocumentBrief {
  /**
   * The document's language as the model read it (BCP 47): the last link of the source-language
   * chain (plan M2 §5), used when the shell could not tell. Absent when the model gave none.
   */
  language?: string;
  /** Empty when the model gave none; the parser drops a brief with no field at all. */
  genre: string;
  audience: string;
  purpose: string;
  tone: string;
  glossary: GlossaryEntry[];
}

/** Per-job state shared by the stages of a strategy (§5.3). */
export interface WorkingMemory {
  brief?: DocumentBrief;
  /** Term decisions so far: the user's glossary first, then auto entries. */
  glossary: GlossaryEntry[];
  /**
   * Latest final text per segment id, kept by the engine from `segment.final` events: the "last
   * good revision" a failing stage falls back to (§5.6).
   */
  translated: Map<string, { text: string; revision: number; attempt?: number }>;
  /** How often each glossary term was used so far. */
  termUsage: Map<string, number>;
}

export interface ContextSnippet {
  providerId: string;
  /**
   * `document`: the same for every chunk of the document once the brief is known, so it goes in
   * the system block (the prompt-caching prefix, §5.7). `chunk`: about this chunk only, so it goes
   * in the user message and never breaks the prefix.
   */
  scope: 'document' | 'chunk';
  text: string;
}

/** What a provider is asked (§5.4's query, plus what the v1 providers read). */
export interface ContextQuery {
  doc: DocMeta;
  chunk: Segment[];
  targetLang: string;
  /** This provider's share of the context budget (providers/budget.ts). */
  maxTokens: number;
  /** Every segment of the document in page order: the chunk's neighbours. */
  segments: readonly Segment[];
  /** Brief, glossary and the text translated so far. Read only. */
  memory: Readonly<WorkingMemory>;
  options: JobOptions;
}

/** §5.4. */
export interface ContextProvider {
  id: string;
  /** Most tokens this provider may use, whatever is left of the budget (the context tail's ~300). */
  maxTokens?: number;
  /**
   * Prompt-ready snippets relevant to this chunk, within `q.maxTokens`. Document-scoped snippets
   * must depend on nothing chunk-specific, so the system block stays byte-identical across chunks.
   */
  provide(q: ContextQuery): Promise<ContextSnippet[]>;
}

/** A versioned prompt asset (§5.5). */
export interface PromptTemplate {
  /** "translate@1": `name@version`. */
  id: string;
  name: string;
  version: number;
  /** Fills `{NAME}` slots. Missing values are an error, so a slot can't be sent empty by accident. */
  render(vars: Readonly<Record<string, string>>): string;
}

export interface PromptRegistry {
  /** Throws for an unknown id. */
  get(id: string): PromptTemplate;
  has(id: string): boolean;
  /** The highest version of `name`. */
  latest(name: string): PromptTemplate | undefined;
}

export interface BudgetLimits {
  /** Input + output tokens for the whole job. */
  maxTokens?: number;
  /** Wall time from the job's start. */
  maxMs?: number;
}

/** §5.6: stages check it, and an optional pass (refine) is skipped once it is exhausted. */
export interface Budget {
  readonly limits: BudgetLimits;
  readonly spent: { readonly input: number; readonly output: number; readonly cachedInput: number };
  /** Called by the engine for every `usage` event. */
  record(usage: { input: number; output: number; cachedInput?: number }): void;
  /** Infinity when there is no token limit. */
  remainingTokens(): number;
  exhausted(): boolean;
}
