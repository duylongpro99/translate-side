// Long tasks and JS heap from outside the extension, over CDP (no hook in the shipped code):
// - a Performance trace of the page tab and the panel tab, whose top-level tasks over a threshold are the
//   long tasks, each placed in the renderer it ran in;
// - a sampling CPU profile of each tab, which says what JS ran inside each long task (the content script
//   runs in the page's renderer, in its isolated world);
// - `Performance.getMetrics` for the JS heap of each tab.
import type { BrowserContext, CDPSession, Page } from '@playwright/test';

interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string; data?: { url?: string; frames?: { url?: string; processId?: number }[] } };
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string };
  children?: number[];
}

interface Profile {
  nodes: ProfileNode[];
  startTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface LongTask {
  /** Microseconds on the trace clock. */
  start: number;
  ms: number;
  /** Sampled JS time inside the task, in ms, by the outermost known function on the stack (`attribute`). */
  js: Record<string, number>;
  /** Rendering and GC inside the task, in ms, from the trace (style, layout, paint, GC). */
  render: Record<string, number>;
}

export interface Recording {
  stop(): Promise<{ tasks: LongTask[]; heap: number }>;
}

/** Top-level task names in the renderer's trace (Chromium has used both). */
const TOP = new Set(['RunTask', 'ThreadControllerImpl::RunTask']);
const RENDER = new Set(['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'MajorGC', 'MinorGC']);

/**
 * Starts recording the renderer of `tab`. Chrome runs one trace at a time, and a tab's trace holds its own
 * renderer: the page and the panel are recorded in separate runs. `attribute` names a sample by its stack
 * (outermost first); samples it returns undefined for count as their own innermost function.
 */
export async function record(context: BrowserContext, tab: Page, attribute: (stack: string[]) => string | undefined): Promise<Recording> {
  const session = await context.newCDPSession(tab);
  await session.send('Performance.enable');
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 200 });
  await session.send('Profiler.start');
  const events: TraceEvent[] = [];
  session.on('Tracing.dataCollected', ({ value }) => void events.push(...(value as unknown as TraceEvent[])));
  await session.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  return {
    async stop() {
      const done = new Promise<void>((resolve) => session.once('Tracing.tracingComplete', () => resolve()));
      await session.send('Tracing.end');
      await done;
      const profile = (await session.send('Profiler.stop')).profile as Profile;
      const heap = await heapOf(session);
      const thread = mainThread(events, tab.url());
      if (thread === undefined) throw new Error(`no renderer main thread for ${tab.url()} in the trace`);
      const tasks: LongTask[] = [];
      for (const e of events) {
        if (!TOP.has(e.name) || e.ph !== 'X' || (e.dur ?? 0) < 50_000 || `${e.pid}:${e.tid}` !== thread) continue;
        const end = e.ts + (e.dur ?? 0);
        const render: Record<string, number> = {};
        for (const c of events) {
          if (!RENDER.has(c.name) || c.ph !== 'X' || c.pid !== e.pid || c.tid !== e.tid || c.ts < e.ts || c.ts > end) continue;
          render[c.name] = Math.round(((render[c.name] ?? 0) + (c.dur ?? 0) / 1000) * 10) / 10;
        }
        tasks.push({ start: e.ts, ms: (e.dur ?? 0) / 1000, js: jsIn(profile, e.ts, end, attribute), render });
      }
      await session.detach();
      return { tasks: tasks.sort((x, y) => x.start - y.start), heap };
    },
  };
}

async function heapOf(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.enable');
  await session.send('HeapProfiler.collectGarbage');
  const { metrics } = await session.send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
}

/** The main thread of the renderer that committed `url` (`pid:tid`). */
function mainThread(events: TraceEvent[], url: string): string | undefined {
  const main = new Map<number, number>();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain') main.set(e.pid, e.tid);
  const base = url.replace(/[?#].*/, '');
  for (const e of events) {
    for (const f of e.args?.data?.frames ?? []) {
      const tid = f.processId === undefined ? undefined : main.get(f.processId);
      if (tid !== undefined && f.url?.startsWith(base)) return `${f.processId}:${tid}`;
    }
  }
  // A tab's trace that names no frame holds its own renderer only.
  return main.size === 1 ? [...main].map(([pid, tid]) => `${pid}:${tid}`)[0] : undefined;
}

function jsIn(profile: Profile, from: number, to: number, attribute: (stack: string[]) => string | undefined): Record<string, number> {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const out: Record<string, number> = {};
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0;
    t += dt;
    if (t < from || t > to) continue;
    const stack: string[] = [];
    for (let id: number | undefined = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const name = byId.get(id)?.callFrame.functionName;
      if (name) stack.unshift(name);
    }
    if (stack.length === 0 || stack.at(-1) === '(idle)' || stack.at(-1) === '(program)') continue;
    const key = attribute(stack) ?? stack.at(-1) ?? '?';
    const next = profile.timeDeltas[i + 1] ?? dt;
    out[key] = (out[key] ?? 0) + next / 1000;
  }
  for (const k of Object.keys(out)) out[k] = Math.round((out[k] ?? 0) * 10) / 10;
  return out;
}
