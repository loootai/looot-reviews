import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS, budgetFieldError } from "./budget";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { FALLBACK_PRICES } from "./prices";
import { buildPlan, runPlan } from "./runner";
import type { Entity } from "./types";

const now = new Date("2026-10-10T09:00:00Z");
const TODAY = "2026-10-10";
const shop = (n: string, role: Entity["role"] = "target"): Entity => ({ id: n, name: n, role, placeId: `ChIJ-${n}` });
const acme = shop("acme");
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number, endpointId: string) => LoootRun | Promise<LoootRun>) {
  const calls: { endpointId: string; key: string }[] = [];
  const looot: LoootRunner = {
    async runAndWait(endpointId, _input, key) {
      calls.push({ endpointId, key });
      return answer(calls.length, endpointId);
    },
  };
  return { looot, calls };
}
const reviews = { reviews: [{ rating: 4, snippet: "Friendly staff and quick service", isoDate: "2026-09-01", review_id: "r1" }] };
const completed = (cost: number): LoootRun => ({ runId: "run_ok", status: "completed", result: reviews, actualCost: cost });
// One Google Maps reviews call per shop: the place id is known, so there is no lookup and the page count is 1.
const planFor = (ents: Entity[], pages = 1, cap = 5_000_000) => buildPlan(ents, ["google_maps"], pages, FALLBACK_PRICES, cap);
const run = (ents: Entity[], looot: LoootRunner, ledger: Budget, extra: { freshTag?: string; today?: string; pages?: number } = {}) =>
  runPlan({ entities: ents, sources: ["google_maps"], plan: planFor(ents, extra.pages), looot, prices: FALLBACK_PRICES, today: extra.today ?? TODAY, now, ledger, freshTag: extra.freshTag });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const s2 = await b.status(new Date("2026-10-11T09:00:00Z"));
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });

  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost and stores the answer", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("runPlan with the budget", () => {
  it("does not charge a repeated identical request twice", async () => {
    const b = open();
    const first = runner(() => completed(0.001));
    const r1 = await run([acme], first.looot, b);
    const second = runner(() => completed(0.001));
    const r2 = await run([acme], second.looot, b);
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    expect(r2.spendMicros).toBe(0);
    expect(r2.runs[0].state).toBe("completed");
    expect(r2.reviews).toHaveLength(r1.reviews.length);
    expect((await b.status(now)).day.usedMicros).toBe(r1.spendMicros);
  });

  it("answers the same request on a later day from the stored result", async () => {
    const b = open();
    const first = runner(() => completed(0.001));
    await run([acme], first.looot, b, { today: "2026-10-10" });
    const later = runner(() => completed(0.001));
    await run([acme], later.looot, b, { today: "2026-10-11" });
    expect(later.calls).toHaveLength(0);
  });

  it("sends a key with no date in it: the same input gives the same key on any day", async () => {
    const a = runner(() => completed(0.001));
    const c = runner(() => completed(0.001));
    await run([acme], a.looot, open(), { today: "2026-10-10" });
    await run([acme], c.looot, new Budget(join(dir, "other.json")), { today: "2027-03-02" });
    expect(c.calls[0].key).toBe(a.calls[0].key);
  });

  it("answers two identical requests started together with one charge", async () => {
    const slow = () => runner(async () => { await new Promise((r) => setTimeout(r, 20)); return completed(0.001); });
    const [a, c] = [slow(), slow()];
    await Promise.all([run([acme], a.looot, open()), run([acme], c.looot, open())]);
    const s = await open().status(now);
    expect(s.day.usedMicros).toBe(1_000);
    expect(s.day.reservedMicros).toBe(0);
  });

  it("charges again only for an explicit fresh pull, which has its own stable key", async () => {
    const b = open();
    const a = runner(() => completed(0.001));
    await run([acme], a.looot, b);
    const c = runner(() => completed(0.001));
    await run([acme], c.looot, b, { freshTag: "oct" });
    const d = runner(() => completed(0.001));
    await run([acme], d.looot, b, { freshTag: "oct" });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].key).not.toBe(a.calls[0].key);
    expect(d.calls).toHaveLength(0);
  });

  it("holds total charges inside the budget when requests run at the same time", async () => {
    await open().setLimits({ dailyMicros: 3_000, monthlyMicros: 3_000 });
    const shops = ["a", "b", "c", "d", "e"].map((n) => shop(n));
    const sources = shops.map(() => runner(async () => { await new Promise((r) => setTimeout(r, 10)); return completed(0.001); }));
    const reports = await Promise.all(shops.map((c, i) => run([c], sources[i].looot, open())));
    const paid = sources.reduce((n, s) => n + s.calls.length, 0);
    const s = await open().status(now);
    expect(paid).toBe(3);
    expect(s.day.usedMicros).toBe(3_000);
    expect(s.day.usedMicros + s.day.reservedMicros).toBeLessThanOrEqual(3_000);
    expect(reports.filter((r) => r.runs.some((x) => x.state === "blocked"))).toHaveLength(2);
  });

  it("stops many small runs one after another at the budget", async () => {
    await open().setLimits({ dailyMicros: 2_500, monthlyMicros: 2_500 });
    const b = open();
    const seen = runner(() => completed(0.001));
    for (let i = 0; i < 8; i++) await run([shop(`s${i}`)], seen.looot, b);
    expect(seen.calls).toHaveLength(2);
    expect((await b.status(now)).day.usedMicros).toBe(2_000);
  });

  it("refuses a call over the budget, says so, and makes no call", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 500, monthlyMicros: 500 });
    const { looot, calls } = runner(() => completed(0.001));
    const report = await run([acme], looot, b);
    expect(calls).toHaveLength(0);
    expect(report.runs.find((r) => r.state === "blocked")?.message).toMatch(/budget is reached/i);
  });

  it("keeps the reservation of a pending call and never records it as $0", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const report = await run([acme], looot, b);
    expect(report.runs[0].state).toBe("pending");
    expect(report.runs[0].costMicros).toBe(1_000);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(1_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("settles a pending call to its real cost when it finishes later", async () => {
    const b = open();
    await run([acme], runner(() => ({ runId: "run_slow", status: "running" })).looot, b);
    await b.reconcile({ getRun: async () => ({ runId: "run_slow", status: "completed", result: reviews, actualCost: 0.0007 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(700);
    const again = runner(() => completed(0.001));
    await run([acme], again.looot, b);
    expect(again.calls).toHaveLength(0);
  });

  it("releases the reservation of a call that looot refused with an HTTP answer", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const report = await run([acme], looot, b);
    expect(report.runs[0].state).toBe("failed");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await run([acme], looot, b);
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await run([acme], looot, b);
    expect((await b.status(now)).day.reservedMicros).toBe(1_000);
  });
});

describe("budget fields in a request", () => {
  it("names a request that tries to carry a budget", () => {
    expect(budgetFieldError({ dailyUsd: 1000 })).toMatch(/cannot set the budget/);
    expect(budgetFieldError({ target: "Acme" })).toBeNull();
  });
});
