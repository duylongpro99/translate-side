// @vitest-environment jsdom
// Failure never loses the page (plan M3-E8): a bad key, a rate limit, one failed segment, and a
// dropped network, each against the real Jobs (and the real engine and its retry) with a scripted client.
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { wireLines, translatorClient } from "@/engine/testing";
import type { EngineEvent, Segment, TranslationEngine } from "@/engine/index";
import type {
  LLMClient,
  LLMError,
  NormalizedEvent,
  NormalizedRequest,
} from "@/llm/types";
import { GEMINI_PROFILE } from "@/shared/settings";
import { JobBar, type JobActions } from "./JobBar.tsx";
import { Jobs, type ClientResult, type JobDoc, type JobView } from "./jobs.ts";
import { SegmentList } from "./SegmentList.tsx";

const by = { strategy: "single-pass", stage: "translate", model: "m" };
const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await settle(2);
  }
}

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
function doc(n: number, w = 120): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const text = `P${i} ${words(w)}`;
    return {
      id: `s${i}`,
      kind: "p",
      text,
      inlineMarkup: text,
      domPath: `/p[${i + 1}]`,
      translate: true,
    };
  });
  return {
    url: "https://example.com/",
    title: "T",
    sourceLang: "en",
    targetLang: "vi",
    segments,
  };
}

const connection = { id: "apibox", label: "APIBOX" };
const ok =
  (client: LLMClient): (() => Promise<ClientResult>) =>
  () =>
    Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE, connection });

/** A client that answers from `inner` while `online`, and with `fail` otherwise. Records what each request asked to translate. */
function flaky(inner: LLMClient, fail: () => NormalizedEvent) {
  const state = { online: true, requested: [] as string[][], calls: 0 };
  const client: LLMClient = {
    model: inner.model,
    reasoningReserveTokens: () => 0,
    async *stream(req: NormalizedRequest) {
      state.calls++;
      state.requested.push(
        wireLines(
          req.messages.find((m) => m.role === "user")?.content ?? "",
        ).map((l) => l.source),
      );
      if (!state.online) {
        await Promise.resolve();
        yield fail();
        return;
      }
      yield* inner.stream(req);
    },
  };
  return { client, state };
}

const final = (id: string, text: string): EngineEvent => ({
  type: "segment.final",
  id,
  text,
  revision: 1,
  producedBy: by,
});
const failedEv = (id: string, error: LLMError): EngineEvent => ({
  type: "segment.failed",
  id,
  error,
});

describe("a bad key (M3-E8)", () => {
  const auth: LLMError = {
    kind: "auth",
    status: 401,
    message: "Key invalid or missing",
  };

  it('stops the job on the first rejection, asks nothing of any other provider, and keeps the connection for "Fix key"', async () => {
    const { client, state } = flaky(translatorClient(), () => ({
      type: "error",
      error: auth,
    }));
    state.online = false;
    let resolved = 0;
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: () => (resolved++, ok(client)()),
    });
    jobs.setActive(1);
    await jobs.start(1, "d", doc(30));
    const v = jobs.get(1) as JobView;
    expect(v).toMatchObject({
      status: "stopped",
      stopError: { kind: "auth" },
      connection,
    });
    // Two chunks were in flight at most; the rest was never sent; the client was resolved once (no fallback route).
    expect(state.calls).toBeLessThanOrEqual(2);
    expect(resolved).toBe(1);
  });

  it("a missing key stops before any request, with the connection named", async () => {
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: () =>
        Promise.resolve({ ok: false, error: auth, connection }),
    });
    jobs.setActive(1);
    await jobs.start(1, "d", doc(3));
    expect(jobs.get(1)).toMatchObject({
      status: "stopped",
      connection,
      stopError: { kind: "auth" },
    });
  });
});

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
  document.body.replaceChildren(root);
});
const actions = (calls: string[]): JobActions => ({
  cancel: () => calls.push("cancel"),
  resume: () => calls.push("resume"),
  openOptions: () => calls.push("options"),
  retrySegment: (id) => calls.push(`retry:${id}`),
  retranslateSegment: (id) => calls.push(`retranslate:${id}`),
  retranslatePage: () => calls.push("retranslate-page"),
  grantAccess: () => calls.push("grant"),
  continuePastLimit: () => calls.push("continue-limit"),
});

describe('"Fix key" (M3-E8)', () => {
  it("shows Fix key inline for a rejected key and opens the settings; no Try again", async () => {
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: () =>
        Promise.resolve({
          ok: false,
          error: {
            kind: "auth",
            message: "Add your APIBOX API key in settings",
          },
          connection,
        }),
    });
    jobs.setActive(1);
    await jobs.start(1, "d", doc(2));
    const calls: string[] = [];
    act(() =>
      render(
        <JobBar job={jobs.get(1) as JobView} actions={actions(calls)} />,
        root,
      ),
    );
    const fix = root.querySelector<HTMLButtonElement>(
      '[data-testid="fix-key"]',
    );
    expect(fix?.textContent).toBe("Fix key");
    expect(fix?.title).toContain("APIBOX");
    expect(root.querySelector('[data-testid="retry-page"]')).toBeNull();
    act(() => fix?.click());
    expect(calls).toEqual(["options"]);
  });
});

describe("a rate limit (M3-E8)", () => {
  it("shows a backoff entry per chunk while the engine waits, and clears it when the attempt starts", async () => {
    const limited = [true, true]; // the first request of each of the two chunks
    const inner = translatorClient();
    const client: LLMClient = {
      model: inner.model,
      reasoningReserveTokens: () => 0,
      async *stream(req) {
        if (limited.length) {
          limited.pop();
          await Promise.resolve();
          yield {
            type: "error",
            error: {
              kind: "rate_limit",
              status: 429,
              message: "slow down",
              retryAfterMs: 4000,
            },
          };
          return;
        }
        yield* inner.stream(req);
      },
    };
    // Backoff sleeps are held until released: the test looks at the job meanwhile.
    const sleeps: { ms: number; release: () => void }[] = [];
    const sleep = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        sleeps.push({ ms, release: resolve });
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: ok(client),
      sleep,
    });
    jobs.setActive(1);
    const run = jobs.start(1, "d", doc(30));
    await until(() => sleeps.length === 2);
    const waiting = (jobs.get(1) as JobView).backoff ?? [];
    expect(waiting.map((b) => b.chunk).sort()).toEqual([0, 1]);
    expect(
      waiting.every(
        (b) =>
          b.kind === "rate_limit" && b.attempt === 1 && b.until !== undefined,
      ),
    ).toBe(true);
    expect(sleeps.map((s) => s.ms)).toEqual([4000, 4000]); // Retry-After honoured

    const calls: string[] = [];
    act(() =>
      render(
        <JobBar job={jobs.get(1) as JobView} actions={actions(calls)} />,
        root,
      ),
    );
    const lines = [
      ...root.querySelectorAll('[data-testid="job-backoff"] li'),
    ].map((li) => li.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/Rate limited · part 1 · retrying in \d+ s/);
    expect(lines[1]).toMatch(/part 2/);

    sleeps.forEach((s) => s.release());
    await run;
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe("done");
    expect(v.backoff ?? []).toEqual([]);
    expect(v.counts).toMatchObject({ final: 30, failed: 0 });
    act(() => render(<JobBar job={v} actions={actions(calls)} />, root));
    expect(root.querySelector('[data-testid="job-backoff"]')).toBeNull();
  });

  it("a limit the engine gives up on is a failure, not a wait: no stale indicator", async () => {
    const { client, state } = flaky(translatorClient(), () => ({
      type: "error",
      error: {
        kind: "rate_limit",
        status: 429,
        message: "slow down",
        retryAfterMs: 120_000,
      },
    }));
    state.online = false;
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: ok(client),
      sleep: () => Promise.resolve(),
    });
    jobs.setActive(1);
    await jobs.start(1, "d", doc(4));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe("done");
    expect(v.backoff ?? []).toEqual([]);
    expect(v.counts.failed).toBe(4);
  });
});

describe("one failed segment (M3-E8)", () => {
  /** A job whose second paragraph failed; the retry engine records what it was asked to translate. */
  function setup(retry: (segs: Segment[]) => EngineEvent[]) {
    const asked: string[][] = [];
    const engine = (): TranslationEngine => ({
      async *translate() {
        yield final("s0", "vi:P0");
        yield failedEv("s1", { kind: "unknown", message: "cut off" });
        yield final("s2", "vi:P2");
        yield { type: "done" };
      },
      async *translateSnippet(req) {
        asked.push(req.segments.map((s) => s.id));
        yield* retry(req.segments);
        yield { type: "done" };
      },
    });
    return {
      asked,
      jobs: new Jobs({
        strategy: "single-pass",
        translateClient: ok(translatorClient()),
        engine,
      }),
    };
  }

  it("Retry on the failed block re-runs that segment only and leaves the others and the job status alone", async () => {
    const { asked, jobs } = setup(([s]) => [final(s?.id ?? "", "vi:P1 again")]);
    jobs.setActive(1);
    await jobs.start(1, "d", doc(3));
    const before = jobs.get(1) as JobView;
    expect(before.counts).toEqual({ total: 3, final: 2, failed: 1 });
    const s0 = before.segs.get("s0");

    const calls: string[] = [];
    act(() =>
      render(
        <SegmentList
          segments={before.segments}
          states={before.segs}
          actions={{ retry: (id) => calls.push(id) }}
        />,
        root,
      ),
    );
    const button = root.querySelector<HTMLButtonElement>(
      '[data-id="s1"] [data-testid="segment-retry"]',
    );
    expect(button?.textContent).toBe("Retry");
    expect(root.querySelectorAll('[data-testid="segment-retry"]')).toHaveLength(
      1,
    );
    act(() => button?.click());
    expect(calls).toEqual(["s1"]);

    await jobs.retrySegment(1, "s1");
    expect(asked).toEqual([["s1"]]);
    const after = jobs.get(1) as JobView;
    expect(after.status).toBe("done");
    expect(after.counts).toEqual({ total: 3, final: 3, failed: 0 });
    expect(after.segs.get("s1")).toMatchObject({
      status: "final",
      text: "vi:P1 again",
    });
    expect(after.segs.get("s0")).toBe(s0);
  });

  it("a retry that fails again keeps the segment failed, with its new error, and offers Retry again", async () => {
    const { jobs } = setup(([s]) => [
      failedEv(s?.id ?? "", { kind: "unknown", message: "still broken" }),
    ]);
    jobs.setActive(1);
    await jobs.start(1, "d", doc(3));
    await jobs.retrySegment(1, "s1");
    const v = jobs.get(1) as JobView;
    expect(v.segs.get("s1")).toMatchObject({
      status: "failed",
      error: { message: "still broken" },
    });
    expect(v.counts).toEqual({ total: 3, final: 2, failed: 1 });
  });

  it("only a failed segment can be retried, and not twice at once", async () => {
    const { asked, jobs } = setup(([s]) => [final(s?.id ?? "", "x")]);
    jobs.setActive(1);
    await jobs.start(1, "d", doc(3));
    await jobs.retrySegment(1, "s0"); // final already
    expect(asked).toEqual([]);
    const both = Promise.all([
      jobs.retrySegment(1, "s1"),
      jobs.retrySegment(1, "s1"),
    ]);
    await both;
    expect(asked).toEqual([["s1"]]);
  });

  it("a real translation through the real engine: the segment comes back and the rest is not sent", async () => {
    // Every request fails with an error that is neither retried nor stops the job: all segments fail.
    const { client, state } = flaky(translatorClient(), () => ({
      type: "error",
      error: { kind: "unknown", message: "boom" },
    }));
    state.online = false;
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: ok(client),
      sleep: () => Promise.resolve(),
    });
    jobs.setActive(1);
    const d = doc(3, 20);
    await jobs.start(1, "d", d);
    expect((jobs.get(1) as JobView).counts).toEqual({
      total: 3,
      final: 0,
      failed: 3,
    });
    state.online = true;
    state.requested.length = 0;
    await jobs.retrySegment(1, "s1");
    expect(state.requested.flat()).toEqual([d.segments[1]?.text]);
    const v = jobs.get(1) as JobView;
    expect(v.segs.get("s1")).toMatchObject({
      status: "final",
      text: `vi:${d.segments[1]?.text}`,
    });
    expect(v.counts).toEqual({ total: 3, final: 1, failed: 2 });
  });
});

describe("segment Retry in other states of the job (review C1, C5)", () => {
  const unknown: LLMError = { kind: "unknown", message: "cut off" };

  it("while the page job is still running: only that segment changes, the job keeps running and then finishes", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => (release = r));
    const engine = (): TranslationEngine => ({
      async *translate() {
        yield failedEv("s1", unknown);
        yield final("s0", "vi:P0");
        await hold;
        yield final("s2", "vi:P2");
        yield { type: "done" };
      },
      async *translateSnippet(req) {
        yield final(req.segments[0]?.id ?? "", "vi:P1 again");
        yield { type: "done" };
      },
    });
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: ok(translatorClient()),
      engine,
    });
    jobs.setActive(1);
    const run = jobs.start(1, "d", doc(3));
    await until(
      () =>
        jobs.get(1)?.segs.get("s1")?.status === "failed" &&
        jobs.get(1)?.segs.get("s0")?.status === "final",
    );
    expect(jobs.get(1)?.status).toBe("running");
    await jobs.retrySegment(1, "s1");
    expect(jobs.get(1)).toMatchObject({
      status: "running",
      counts: { total: 3, final: 2, failed: 0 },
    });
    expect(jobs.get(1)?.segs.get("s2")?.status).toBe("pending");
    release();
    await run;
    expect(jobs.get(1)).toMatchObject({
      status: "done",
      counts: { total: 3, final: 3, failed: 0 },
    });
  });

  it("a network failure inside the retry fails that segment only: the finished job stays done", async () => {
    const net: LLMError = { kind: "network", message: "Failed to fetch" };
    const engine = (): TranslationEngine => ({
      async *translate() {
        yield final("s0", "vi:P0");
        yield failedEv("s1", unknown);
        yield final("s2", "vi:P2");
        yield { type: "done" };
      },
      async *translateSnippet(req) {
        yield failedEv(req.segments[0]?.id ?? "", net);
        yield { type: "done" };
      },
    });
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: ok(translatorClient()),
      engine,
    });
    jobs.setActive(1);
    await jobs.start(1, "d", doc(3));
    await jobs.retrySegment(1, "s1");
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe("done");
    expect(v.stopError).toBeUndefined();
    expect(v.segs.get("s1")).toMatchObject({
      status: "failed",
      error: { kind: "network" },
    });
    expect(v.counts).toEqual({ total: 3, final: 2, failed: 1 });
  });

  it("Resume while a segment Retry is in flight: the retry is abandoned, the resumed run translates the segment", async () => {
    let retryAborted = false;
    let runs = 0;
    const engine = (): TranslationEngine => ({
      async *translate(job) {
        if (runs++ === 0) {
          yield final("s0", "vi:P0");
          yield failedEv("s1", unknown);
          yield final("s2", "vi:P2");
        } else
          for (const s of job.doc.segments)
            if (s.translate) yield final(s.id, `vi:${s.id} resumed`);
        yield { type: "done" };
      },
      async *translateSnippet(_, signal) {
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => ((retryAborted = true), resolve()),
            { once: true },
          ),
        );
        yield final("s1", "vi:late retry");
      },
    });
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: ok(translatorClient()),
      engine,
    });
    jobs.setActive(1);
    await jobs.start(1, "d", doc(3));
    const retry = jobs.retrySegment(1, "s1");
    await settle(5);
    expect(jobs.get(1)?.segs.get("s1")?.status).toBe("pending");
    await jobs.resume(1);
    await retry;
    expect(retryAborted).toBe(true);
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe("done");
    expect(v.segs.get("s1")).toMatchObject({
      status: "final",
      text: "vi:s1 resumed",
    });
    expect(v.counts).toEqual({ total: 3, final: 3, failed: 0 });
  });

  it("a segment retry and the analyze call do not share a backoff entry", async () => {
    // The retry's request is rate limited while the page job is idle: its entry is its own, and it clears.
    const inner = translatorClient();
    let limited = false;
    const client: LLMClient = {
      model: inner.model,
      reasoningReserveTokens: () => 0,
      async *stream(req) {
        if (limited) {
          limited = false;
          yield {
            type: "error",
            error: {
              kind: "rate_limit",
              status: 429,
              message: "slow",
              retryAfterMs: 1000,
            },
          };
          return;
        }
        yield* inner.stream(req);
      },
    };
    const sleeps: (() => void)[] = [];
    const sleep = (_: number, signal: AbortSignal) =>
      new Promise<void>(
        (resolve, reject) => (
          sleeps.push(resolve),
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        ),
      );
    const failing = flaky(inner, () => ({ type: "error", error: unknown }));
    failing.state.online = false;
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: (() => {
        let n = 0;
        return () =>
          Promise.resolve<ClientResult>({
            ok: true,
            client: n++ === 0 ? failing.client : client,
            profile: GEMINI_PROFILE,
            connection,
          });
      })(),
      sleep,
    });
    jobs.setActive(1);
    await jobs.start(1, "d", doc(2));
    limited = true;
    const retry = jobs.retrySegment(1, "s0");
    await until(() => sleeps.length === 1);
    const entries = (jobs.get(1) as JobView).backoff ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.chunk).toBeLessThan(-1);
    sleeps[0]?.();
    await retry;
    expect((jobs.get(1) as JobView).backoff ?? []).toEqual([]);
    expect((jobs.get(1) as JobView).segs.get("s0")?.status).toBe("final");
  });
});

describe("the network drops mid-job (M3-E8)", () => {
  it("finished segments stay, the job stops with Retry, and Retry runs only the missing ones", async () => {
    const inner = translatorClient();
    const { client, state } = flaky(inner, () => ({
      type: "error",
      error: { kind: "network", message: "Failed to fetch" },
    }));
    const jobs = new Jobs({
      strategy: "single-pass",
      translateClient: ok(client),
      sleep: () => Promise.resolve(),
    });
    jobs.setActive(1);
    // Cut the network once the first chunk is done.
    const cut = jobs.subscribe((_, v) => {
      if (v && v.counts.final > 0 && v.status === "running")
        state.online = false;
    });
    const d = doc(40);
    await jobs.start(1, "d", d);
    const stopped = jobs.get(1) as JobView;
    expect(stopped.status).toBe("stopped");
    expect(stopped.stopError?.kind).toBe("network");
    expect(stopped.counts.final).toBeGreaterThan(0);
    expect(stopped.counts.final).toBeLessThan(40);
    expect(stopped.backoff ?? []).toEqual([]);
    const finals = new Map(
      [...stopped.segs].filter(([, s]) => s.status === "final"),
    );

    const calls: string[] = [];
    act(() => render(<JobBar job={stopped} actions={actions(calls)} />, root));
    expect(root.textContent).toMatch(
      /Lost the connection · \d+ of 40 translated/,
    );
    const retry = root.querySelector<HTMLButtonElement>(
      '[data-testid="retry-page"]',
    );
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    expect(calls).toEqual(["resume"]);

    cut();
    // Back online: the page-wide Retry (resume) sends only what is missing.
    state.online = true;
    state.requested.length = 0;
    await jobs.resume(1);
    const done = jobs.get(1) as JobView;
    expect(done.status).toBe("done");
    expect(done.counts).toEqual({ total: 40, final: 40, failed: 0 });
    const resent = new Set(state.requested.flat());
    for (const [id] of finals)
      expect(resent.has(d.segments.find((s) => s.id === id)?.text ?? "")).toBe(
        false,
      );
    for (const [id, s] of finals) expect(done.segs.get(id)).toBe(s);
  });
});

describe("the fallback note (plan M4-E9)", () => {
  it("says which model took over and why, while running and after", () => {
    const base = {
      paused: false,
      model: "qwen3:8b",
      targetLang: "vi",
      sourceLang: "en",
      segments: [],
      segs: new Map(),
      counts: { total: 3, final: 1, failed: 0 },
      usage: { input: 0, cachedInput: 0, output: 0 },
      cost: undefined,
      unmetered: 0,
      startedAt: 0,
    } satisfies Omit<JobView, "status">;
    const fallback = {
      from: "qwen3:8b",
      to: "claude-haiku-4-5",
      error: {
        kind: "network" as const,
        message: "Can't reach localhost:11434",
      },
    };
    act(() =>
      render(
        <JobBar
          job={{ ...base, status: "running", fallback }}
          actions={actions([])}
        />,
        root,
      ),
    );
    expect(
      root.querySelector('[data-testid="job-fallback"]')?.textContent,
    ).toBe(
      "qwen3:8b is unreachable; continuing with claude-haiku-4-5. Blocks it translated are marked.",
    );
    act(() =>
      render(
        <JobBar
          job={{
            ...base,
            status: "done",
            fallback: {
              ...fallback,
              error: { kind: "rate_limit", message: "slow" },
            },
          }}
          actions={actions([])}
        />,
        root,
      ),
    );
    expect(
      root.querySelector('[data-testid="job-fallback"]')?.textContent,
    ).toBe(
      "qwen3:8b is rate limited; continued with claude-haiku-4-5. Blocks it translated are marked.",
    );
    act(() =>
      render(
        <JobBar job={{ ...base, status: "done" }} actions={actions([])} />,
        root,
      ),
    );
    expect(root.querySelector('[data-testid="job-fallback"]')).toBeNull();
  });
});
