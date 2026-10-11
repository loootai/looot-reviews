import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Budget } from "@/lib/budget";
import { FALLBACK_PRICES } from "@/lib/prices";
import { main, type CliDeps } from "./main";

function deps(over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const d: CliDeps = { log: (s) => out.push(s), err: (s) => err.push(s), env: {}, refine: null, ...over };
  return { d, out, err };
}

const YAML = `target:\n  name: Me Cafe\n  location: Austin\ncompetitors:\n  - name: Rival\n    placeId: ChIJ1\n    appStoreId: 123\n`;

describe("cli", () => {
  it("--dry-run prints the plan and the list-price total and makes no call", async () => {
    let called = false;
    const { d, out } = deps({ looot: { runAndWait: async () => { called = true; throw new Error("no"); } } });
    expect(await main(["--target", "Me @ Austin", "--competitors", "A @ Austin; B @ Austin", "--dry-run"], d)).toBe(0);
    expect(called).toBe(false);
    const text = out.join("\n");
    expect(text).toMatch(/serper-places/);
    expect(text).toMatch(/Up to \$0\.0\d+/);
    expect(text).toMatch(/Dry run: no looot call was made/);
  });

  it("reads a YAML config and adds the sources its ids unlock", async () => {
    const { d, out } = deps({ readFile: () => YAML });
    expect(await main(["--config", "x.yaml", "--dry-run"], d)).toBe(0);
    expect(out.join("\n")).toMatch(/searchapi-io-apple-product-reviews/);
  });

  it("exits 2 without a token, a target, a valid source, valid pages or a valid cap", async () => {
    const a = deps();
    expect(await main(["--target", "Me"], a.d)).toBe(2);
    expect(a.err.join("")).toMatch(/LOOOT_TOKEN is not set/);
    expect(await main([], deps().d)).toBe(2);
    const b = deps();
    expect(await main(["--target", "Me", "--sources", "trustpilot", "--dry-run"], b.d)).toBe(2);
    expect(b.err.join("")).toMatch(/Trustpilot and G2 are not available/);
    expect(await main(["--target", "Me", "--pages", "9", "--dry-run"], deps().d)).toBe(2);
    expect(await main(["--target", "Me", "--max-spend", "-1", "--dry-run"], deps().d)).toBe(2);
  });

  it("runs, writes json, csv and markdown, and exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rev-"));
    const { d } = deps({
      env: { LOOOT_TOKEN: "x", LOOOT_REVIEWS_DATA_DIR: dir },
      looot: { runAndWait: async (e) => (e === "serper-places" ? { runId: "p", status: "completed", result: { places: [{ cid: "1" }] } } : { runId: "r", status: "completed", result: { reviews: [{ rating: 2, snippet: "Slow and the queue was long", isoDate: "2026-09-01", review_id: "a" }, { rating: 5, snippet: "Friendly staff", isoDate: "2026-09-02", review_id: "b" }] }, actualCost: 0.001 }) },
      prices: async () => ({ prices: FALLBACK_PRICES, source: "catalog", unread: [] }),
    });
    expect(await main(["--target", "Me @ Austin", "--pages", "1", "--out", dir], d)).toBe(0);
    for (const f of ["reviews.json", "reviews.csv", "brief.md"]) expect(existsSync(join(dir, f))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "reviews.json"), "utf8")).reviews).toHaveLength(2);
  });

  it("exits 1 and says pending when a run is still going", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rev-"));
    const { d, out } = deps({ env: { LOOOT_TOKEN: "x", LOOOT_REVIEWS_DATA_DIR: dir }, looot: { runAndWait: async () => ({ runId: "r", status: "running" }) }, prices: async () => ({ prices: FALLBACK_PRICES, source: "catalog", unread: [] }) });
    expect(await main(["--target", "Me @ Austin", "--out", dir], d)).toBe(1);
    expect(out.join("\n")).toMatch(/pending, not failed/);
  });

  it("--demo writes the invented-shop report without a token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rev-"));
    expect(await main(["--demo", "--out", dir], deps().d)).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "reviews.json"), "utf8")).mode).toBe("demo");
  });

  it("refuses a run whose quote is above what is left of the period budget, and runs with --partial", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rev-"));
    await new Budget(join(dir, "budget.json")).setLimits({ dailyMicros: 1_500, monthlyMicros: 1_500 });
    let calls = 0;
    const { d, err } = deps({
      env: { LOOOT_TOKEN: "x", LOOOT_REVIEWS_DATA_DIR: dir },
      looot: { runAndWait: async (e) => { calls++; return e === "serper-places" ? { runId: "p", status: "completed", result: { places: [{ cid: "1" }] }, actualCost: 0.001 } : { runId: "r", status: "completed", result: { reviews: [] }, actualCost: 0.001 }; } },
      prices: async () => ({ prices: FALLBACK_PRICES, source: "catalog", unread: [] }),
    });
    expect(await main(["--target", "Me @ Austin", "--pages", "1", "--out", dir], d)).toBe(2);
    expect(err.join("")).toMatch(/above what is left of the period budget/);
    expect(calls).toBe(0);
    expect(await main(["--target", "Me @ Austin", "--pages", "1", "--partial", "--out", dir], d)).toBe(1);
    expect(calls).toBe(1);
  });
});
