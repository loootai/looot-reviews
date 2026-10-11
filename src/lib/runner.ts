import { createHash } from "node:crypto";
import { analyze } from "./analyze";
import type { Ledger } from "./budget";
import { LoootError, TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { SOURCE_DEFS, type CallCtx, type CallLine, type SourceDef } from "./sources";
import { SpendGuard, type PriceMap } from "./spend";
import type { Entity, Report, Review, SourceId, SourceRun } from "./types";

export interface PlanLine extends CallLine {
  entityId: string;
  source: SourceId;
  /** Price of one call. */
  priceMicros: number;
}

export interface Plan {
  lines: PlanLine[];
  /** Entities with no source that applies. */
  skipped: { entityId: string; reason: string }[];
  /** The most the plan can cost: every call at its price, every page fetched. */
  maxMicros: number;
  /** The cost when every source returns one page only. */
  minMicros: number;
  capMicros: number;
  pages: number;
  withinCap: boolean;
}

/** Works out the calls a run can make and what they cost. Makes no call. */
export function buildPlan(entities: Entity[], sources: SourceId[], pages: number, prices: PriceMap, capMicros: number, defs: SourceDef[] = SOURCE_DEFS): Plan {
  const lines: PlanLine[] = [];
  const skipped: Plan["skipped"] = [];
  for (const e of entities) {
    let any = false;
    for (const d of defs.filter((x) => sources.includes(x.id) && x.applies(e))) {
      any = true;
      for (const l of d.lines(e, pages)) lines.push({ ...l, entityId: e.id, source: d.id, priceMicros: prices[l.endpointId] ?? 0 });
    }
    if (!any) skipped.push({ entityId: e.id, reason: "No source applies. Add a name for Google Maps, or an App Store, Google Play or Tripadvisor id." });
  }
  const maxMicros = lines.reduce((n, l) => n + l.maxCalls * l.priceMicros, 0);
  const minMicros = lines.reduce((n, l) => n + Math.min(1, l.maxCalls) * l.priceMicros, 0);
  return { lines, skipped, maxMicros, minMicros, capMicros, pages, withinCap: maxMicros <= capMicros };
}

/** Hash of what a paid call asks for: endpoint and input, with sorted keys and lowercased text. Guards the short key against a collision. */
export function callFingerprint(endpointId: string, input: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => (typeof v === "string" ? v.trim().toLowerCase() : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, norm(x)])) : v);
  return createHash("sha256").update(JSON.stringify([endpointId, norm(input)])).digest("hex");
}

/**
 * Stable key for one (endpoint, input). No date or time goes in, and no input of any call carries a date.
 * The same input replays the stored result and is never charged twice. `tag` starts a fresh pull, with its own stable key.
 */
export function idempotencyKey(endpointId: string, input: Record<string, unknown>, tag = ""): string {
  const sorted = Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
  return `looot-reviews:${endpointId}:${createHash("sha256").update(JSON.stringify([endpointId, sorted, tag])).digest("hex").slice(0, 24)}`;
}

export interface RunOptions {
  entities: Entity[];
  sources: SourceId[];
  plan: Plan;
  looot: LoootRunner;
  prices: PriceMap;
  /** Endpoints whose live price could not be read. They are not called. */
  unpriced?: string[];
  today: string;
  freshTag?: string;
  /** Period budget, reservations and stored answers. Left out in tests that do not need it. */
  ledger?: Ledger;
  /** The clock for the ledger. Defaults to now. */
  now?: Date;
  /** Optional step that renames and merges themes. Never required. */
  refine?: Parameters<typeof analyze>[2];
  onProgress?: (run: SourceRun) => void;
  defs?: SourceDef[];
}

/** A ledger write that fails (a locked file) must not hide a call that already ran. The reservation then stays until the next reconcile or the hard expiry. */
async function quiet(fn: () => Promise<void> | undefined): Promise<void> {
  try {
    await fn();
  } catch {
    // The call result is already in hand; the reservation stays held, which errs on the side of spending less.
  }
}

/**
 * Makes the calls one after another and builds the report.
 * Check order for each call: the quote, the per-run cap, a stored answer, the period budget (an atomic reservation), then the call.
 * A refused call costs nothing. A finished call is stored, so the same request is answered later with no call.
 * A call still going when waiting stops is "pending", counts at its quoted price, and ends that source.
 * A failed call costs nothing.
 */
export async function runPlan(opts: RunOptions): Promise<Report> {
  const guard = new SpendGuard(opts.plan.capMicros);
  const unpriced = new Set(opts.unpriced ?? []);
  const runs: SourceRun[] = [];
  const reviews: Review[] = [];
  const defs = opts.defs ?? SOURCE_DEFS;

  for (const s of opts.plan.skipped) runs.push({ entityId: s.entityId, source: "google_maps", step: "none", jobId: "", endpointId: "", state: "skipped", costMicros: 0, reviewCount: 0, message: s.reason });

  for (const e of opts.entities) {
    for (const d of defs.filter((x) => opts.sources.includes(x.id) && x.applies(e))) {
      let stop = false;
      const ctx: CallCtx = {
        today: opts.today,
        pages: opts.plan.pages,
        async call(spec, parse, count) {
          const base = { entityId: e.id, source: d.id, step: spec.step, jobId: spec.jobId, endpointId: spec.endpointId };
          const push = (r: SourceRun) => { runs.push(r); opts.onProgress?.(r); };
          const price = opts.prices[spec.endpointId] ?? 0;
          if (stop) return { ok: false };
          if (unpriced.has(spec.endpointId)) { push({ ...base, state: "blocked", costMicros: 0, reviewCount: 0, message: "The live price could not be read, so the call was not made." }); return { ok: false }; }
          if (!guard.canAfford(price)) { push({ ...base, state: "blocked", costMicros: 0, reviewCount: 0, message: `Spend cap reached (${guard.describe()}).` }); stop = true; return { ok: false }; }
          const key = idempotencyKey(spec.endpointId, spec.input, opts.freshTag);
          const fp = callFingerprint(spec.endpointId, spec.input);
          const ledger = opts.ledger;
          const at = opts.now ?? new Date();
          const finish = (res: LoootRun, cost: number, note?: string) => {
            const value = parse(res.result);
            const n = count(value);
            push({ ...base, state: "completed", runId: res.runId, costMicros: cost, reviewCount: n, message: note ?? (n === 0 && spec.step !== "place lookup" ? "The provider returned no reviews for this input." : undefined) });
            return value;
          };
          if (ledger) {
            const stored = await ledger.recall(key, fp, at);
            if (stored) return { ok: true, value: finish(stored, 0, "Answered from the stored result. No call, no charge.") };
            const held = await ledger.reserve(key, price, at, fp);
            if (!held.ok) { push({ ...base, state: "blocked", costMicros: 0, reviewCount: 0, message: held.message }); stop = true; return { ok: false }; }
          }
          try {
            const res = await opts.looot.runAndWait(spec.endpointId, spec.input, key);
            if (!TERMINAL_STATUSES.has(res.status)) {
              // Still running at looot: the reservation stays until the run ends. It is never recorded as failed at zero.
              guard.record(price);
              await quiet(() => ledger?.attach(key, res.runId));
              push({ ...base, state: "pending", runId: res.runId, costMicros: price, reviewCount: 0, message: `Still ${res.status} when waiting stopped. Not failed. Run the same command again; the stored run is replayed and not charged twice.` });
              stop = true;
              return { ok: false };
            }
            if (res.status !== "completed") {
              await quiet(() => ledger?.settle(key, fp, toMicros(res.actualCost), at));
              push({ ...base, state: "failed", runId: res.runId, costMicros: 0, reviewCount: 0, message: res.error?.message ?? `The run ended as ${res.status}. Nothing was charged.` });
              stop = true;
              return { ok: false };
            }
            const cost = res.actualCost === null || res.actualCost === undefined ? price : toMicros(res.actualCost);
            guard.record(cost);
            await quiet(() => ledger?.settle(key, fp, cost, at, res));
            return { ok: true, value: finish(res, cost) };
          } catch (err) {
            // An HTTP answer from looot means the call did not run, so the reservation goes back. A network error is unknown:
            // the request may have been accepted, so the reservation stays until the hard expiry or a replay settles it.
            if (err instanceof LoootError) await quiet(() => ledger?.release(key));
            const msg = err instanceof LoootError ? `${err.message}${err.code ? ` (${err.code})` : ""}` : (err as Error).message;
            push({ ...base, state: "failed", costMicros: 0, reviewCount: 0, message: msg });
            stop = true;
            return { ok: false };
          }
        },
      };
      reviews.push(...(await d.collect(e, ctx)));
    }
  }

  const analysis = await analyze(opts.entities, reviews, opts.refine, new Date(`${opts.today}T12:00:00Z`));
  return { version: 1, createdAt: `${opts.today}T12:00:00.000Z`, mode: "live", entities: opts.entities, reviews, runs, spendMicros: guard.spentMicros, capMicros: opts.plan.capMicros, ...analysis };
}

/**
 * What the plan can still charge: the most each line can cost, unless its first call has a stored answer in the ledger.
 * A repeat of a finished pull costs 0 here, so the up-front budget check does not refuse a request that is answered with no call.
 * A line whose first input is not known before the run (reviews after a place lookup) counts in full.
 */
export async function chargeableMicros(plan: Plan, ledger: Ledger, opts: { freshTag?: string; now?: Date } = {}): Promise<number> {
  let total = 0;
  for (const line of plan.lines) {
    const stored = line.firstInput ? await ledger.recall(idempotencyKey(line.endpointId, line.firstInput, opts.freshTag), callFingerprint(line.endpointId, line.firstInput), opts.now ?? new Date()) : null;
    if (!stored) total += line.maxCalls * line.priceMicros;
  }
  return total;
}
