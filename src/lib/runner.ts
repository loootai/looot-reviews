import { createHash } from "node:crypto";
import { analyze } from "./analyze";
import { LoootError, TERMINAL_STATUSES, type LoootRunner } from "./looot";
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

/** Stable key for one (endpoint, input). The same input replays the stored run and is never charged twice. `tag` starts a fresh pull. */
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
  /** Optional step that renames and merges themes. Never required. */
  refine?: Parameters<typeof analyze>[2];
  onProgress?: (run: SourceRun) => void;
  defs?: SourceDef[];
}

/**
 * Makes the calls one after another and builds the report.
 * Before each call the guard checks the cap. A refused call costs nothing.
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
          try {
            const res = await opts.looot.runAndWait(spec.endpointId, spec.input, idempotencyKey(spec.endpointId, spec.input, opts.freshTag));
            if (!TERMINAL_STATUSES.has(res.status)) {
              guard.record(price);
              push({ ...base, state: "pending", runId: res.runId, costMicros: price, reviewCount: 0, message: `Still ${res.status} when waiting stopped. Not failed. Run the same command again; the stored run is replayed and not charged twice.` });
              stop = true;
              return { ok: false };
            }
            if (res.status !== "completed") {
              push({ ...base, state: "failed", runId: res.runId, costMicros: 0, reviewCount: 0, message: res.error?.message ?? `The run ended as ${res.status}. Nothing was charged.` });
              stop = true;
              return { ok: false };
            }
            const cost = res.actualCost === null || res.actualCost === undefined ? price : toMicros(res.actualCost);
            guard.record(cost);
            const value = parse(res.result);
            const n = count(value);
            push({ ...base, state: "completed", runId: res.runId, costMicros: cost, reviewCount: n, message: n === 0 && spec.step !== "place lookup" ? "The provider returned no reviews for this input." : undefined });
            return { ok: true, value };
          } catch (err) {
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
