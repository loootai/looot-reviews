import { describe, expect, it } from "vitest";
import type { LoootRun, LoootRunner } from "./looot";
import { LoootError } from "./looot";
import { FALLBACK_PRICES } from "./prices";
import { buildPlan, idempotencyKey, runPlan } from "./runner";
import type { Entity } from "./types";

const me: Entity = { id: "me", name: "Me Cafe", location: "Austin", role: "target" };
const rival: Entity = { id: "rival", name: "Rival", role: "competitor", placeId: "ChIJ-rival", appStoreId: "999" };
const reviewsOf = (n: number, token?: string) => ({ reviews: Array.from({ length: n }, (_, i) => ({ rating: 4, snippet: `Review number ${i} about the service`, isoDate: "2026-09-01", review_id: `r${i}-${Math.random()}` })), ...(token ? { nextPageToken: token } : {}) });
const ok = (result: unknown, actualCost?: number): LoootRun => ({ runId: `run-${Math.random()}`, status: "completed", result, actualCost });

function mock(fn: (endpointId: string, input: Record<string, unknown>) => Promise<LoootRun>) {
  const calls: { endpointId: string; input: Record<string, unknown>; key: string }[] = [];
  const looot: LoootRunner = { runAndWait: (e, i, k) => { calls.push({ endpointId: e, input: i, key: k }); return fn(e, i); } };
  return { looot, calls };
}

const base = { today: "2026-10-10", prices: FALLBACK_PRICES };

describe("buildPlan", () => {
  it("adds a place lookup only when there is no place id, and prices every step", () => {
    const plan = buildPlan([me, rival], ["google_maps", "app_store"], 2, FALLBACK_PRICES, 1_000_000);
    expect(plan.lines.map((l) => `${l.entityId}:${l.endpointId}:${l.maxCalls}`)).toEqual(["me:serper-places:1", "me:serper-reviews:2", "rival:serper-reviews:2", "rival:searchapi-io-apple-product-reviews:2"]);
    expect(plan.maxMicros).toBe(1000 + 2 * 1000 + 2 * 1000 + 2 * 4000);
    expect(plan.minMicros).toBe(1000 + 1000 + 1000 + 4000);
  });
  it("skips an entity no source applies to", () => {
    const plan = buildPlan([{ id: "x", name: "", role: "competitor" }], ["app_store"], 1, FALLBACK_PRICES, 1);
    expect(plan.skipped).toHaveLength(1);
  });
});

describe("idempotencyKey", () => {
  it("is stable, order independent and changes with the fresh tag", () => {
    expect(idempotencyKey("e", { a: 1, b: 2 })).toBe(idempotencyKey("e", { b: 2, a: 1 }));
    expect(idempotencyKey("e", { a: 1 }, "x")).not.toBe(idempotencyKey("e", { a: 1 }));
  });
});

describe("runPlan", () => {
  it("looks the place up, then pages reviews until the token runs out", async () => {
    const { looot, calls } = mock(async (e, input) => {
      if (e === "serper-places") return ok({ places: [{ title: "Me Cafe", cid: "555" }] });
      return ok(reviewsOf(3, input.nextPageToken ? undefined : "tok"), 0.001);
    });
    const plan = buildPlan([me], ["google_maps"], 3, FALLBACK_PRICES, 1_000_000);
    const report = await runPlan({ ...base, entities: [me], sources: ["google_maps"], plan, looot });
    expect(calls.map((c) => c.endpointId)).toEqual(["serper-places", "serper-reviews", "serper-reviews"]);
    expect(calls[1].input).toMatchObject({ cid: "555", sortBy: "newest" });
    expect(calls[2].input.nextPageToken).toBe("tok");
    expect(report.reviews).toHaveLength(6);
    expect(report.spendMicros).toBe(1000 + 1000 + 1000);
    expect(report.themes.length).toBeGreaterThanOrEqual(0);
  });

  it("uses a known place id and skips the lookup", async () => {
    const { looot, calls } = mock(async () => ok(reviewsOf(2)));
    const plan = buildPlan([rival], ["google_maps"], 1, FALLBACK_PRICES, 1e6);
    await runPlan({ ...base, entities: [rival], sources: ["google_maps"], plan, looot });
    expect(calls).toHaveLength(1);
    expect(calls[0].input.placeId).toBe("ChIJ-rival");
  });

  it("stops at the cap and makes no call it cannot afford", async () => {
    const { looot, calls } = mock(async () => ok(reviewsOf(2, "more")));
    const plan = buildPlan([rival], ["google_maps", "app_store"], 3, FALLBACK_PRICES, 2500);
    const report = await runPlan({ ...base, entities: [rival], sources: ["google_maps", "app_store"], plan, looot });
    expect(calls).toHaveLength(2);
    expect(report.spendMicros).toBe(2000);
    expect(report.runs.some((r) => r.state === "blocked")).toBe(true);
  });

  it("marks a run still going as pending, not failed, and charges its quoted price", async () => {
    const { looot } = mock(async () => ({ runId: "r1", status: "running" }));
    const plan = buildPlan([rival], ["google_maps"], 2, FALLBACK_PRICES, 1e6);
    const report = await runPlan({ ...base, entities: [rival], sources: ["google_maps"], plan, looot });
    expect(report.runs[0]).toMatchObject({ state: "pending", runId: "r1", costMicros: 1000 });
    expect(report.runs).toHaveLength(1);
  });

  it("costs nothing for a failed run or an HTTP error, and goes on to the next source", async () => {
    const { looot, calls } = mock(async (e) => {
      if (e === "serper-reviews") return { runId: "r2", status: "failed", error: { message: "provider down" } };
      throw new LoootError("bad token", 401, "unauthorized");
    });
    const plan = buildPlan([rival], ["google_maps", "app_store"], 1, FALLBACK_PRICES, 1e6);
    const report = await runPlan({ ...base, entities: [rival], sources: ["google_maps", "app_store"], plan, looot });
    expect(calls).toHaveLength(2);
    expect(report.runs.map((r) => r.state)).toEqual(["failed", "failed"]);
    expect(report.runs[1].message).toContain("unauthorized");
    expect(report.spendMicros).toBe(0);
  });

  it("does not call an endpoint whose live price could not be read", async () => {
    const { looot, calls } = mock(async () => ok(reviewsOf(1)));
    const plan = buildPlan([rival], ["google_maps"], 1, FALLBACK_PRICES, 1e6);
    const report = await runPlan({ ...base, entities: [rival], sources: ["google_maps"], plan, looot, unpriced: ["serper-reviews"] });
    expect(calls).toHaveLength(0);
    expect(report.runs[0].state).toBe("blocked");
  });

  it("sends each call with the stable key", async () => {
    const { looot, calls } = mock(async () => ok(reviewsOf(1)));
    const plan = buildPlan([rival], ["google_maps"], 1, FALLBACK_PRICES, 1e6);
    await runPlan({ ...base, entities: [rival], sources: ["google_maps"], plan, looot });
    expect(calls[0].key).toBe(idempotencyKey("serper-reviews", calls[0].input));
  });

  it("passes the optional refiner through to the report", async () => {
    const { looot } = mock(async () => ok({ reviews: Array.from({ length: 8 }, (_, i) => ({ rating: 1, snippet: i % 2 ? `The wait was long and the queue slow ${i}` : `Far too expensive for the price ${i}`, review_id: `w${i}` })) }));
    const plan = buildPlan([rival], ["google_maps"], 1, FALLBACK_PRICES, 1e6);
    const report = await runPlan({ ...base, entities: [rival], sources: ["google_maps"], plan, looot, refine: async () => [{ label: "Queues", from: [0] }] });
    expect(report.themeMethod).toBe("keywords+llm");
  });
});
