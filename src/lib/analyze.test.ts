import { describe, expect, it } from "vitest";
import { analyze, applyRefinement, buildThemes, findPhraseThemes, findWeakSpots, summarizeEntity } from "./analyze";
import type { Entity, Review } from "./types";
import { demoReport, demoReviews, DEMO_ENTITIES } from "@/demo/seed";

const mk = (entityId: string, rating: number, text: string, date?: string, i = Math.random()): Review => ({ id: `${entityId}-${i}`, entityId, source: "google_maps", rating, text, date });

describe("buildThemes", () => {
  const reviews = [
    mk("a", 1, "We waited an hour for coffee. Slow, slow, slow.", undefined, 1),
    mk("a", 2, "Long wait at the counter and the queue never moved.", undefined, 2),
    mk("b", 5, "Friendly staff and great service every time.", undefined, 3),
    mk("b", 4, "The staff are helpful and the service is quick.", undefined, 4),
    mk("b", 5, "Lovely service, friendly staff.", undefined, 5),
  ];
  it("counts named themes and the entities behind them", () => {
    const themes = buildThemes(reviews);
    const wait = themes.find((t) => t.label === "Wait times");
    const staff = themes.find((t) => t.label === "Staff and service");
    expect(wait?.total).toBe(2);
    expect(wait?.byEntity.a).toMatchObject({ count: 2, avgRating: 1.5, negative: 2 });
    expect(staff?.total).toBe(3);
    expect(staff?.byEntity.b.positive).toBe(3);
  });
  it("gives each theme example quotes drawn from its reviews", () => {
    const wait = buildThemes(reviews).find((t) => t.label === "Wait times");
    expect(wait?.quotes.length).toBeGreaterThan(0);
    expect(wait?.quotes[0].text.toLowerCase()).toMatch(/wait|queue|slow/);
  });
  it("returns nothing for no reviews", () => {
    expect(buildThemes([])).toEqual([]);
  });
});

describe("findPhraseThemes", () => {
  const texts = Array.from({ length: 10 }, (_, i) => (i < 6 ? `The pistachio croissant is flaky number ${i}.` : `Nice room ${i}.`));
  const reviews = texts.map((t, i) => mk("a", 5, t, undefined, i));
  it("finds a repeated phrase and merges its parts into one theme", () => {
    const found = findPhraseThemes(reviews, () => false);
    expect(found.length).toBeGreaterThan(0);
    const lead = found.find((f) => f.keywords.some((k) => k.includes("pistachio")));
    expect(lead).toBeDefined();
    expect(lead?.keywords).toEqual(expect.arrayContaining(["pistachio croissant"]));
  });
  it("does nothing on a tiny corpus", () => {
    expect(findPhraseThemes(reviews.slice(0, 4), () => false)).toEqual([]);
  });
  it("skips phrases a named theme already covers", () => {
    const found = findPhraseThemes(reviews, (p) => p.includes("pistachio"));
    expect(found.flatMap((f) => f.keywords).some((k) => k.includes("pistachio"))).toBe(false);
  });
});

describe("summarizeEntity", () => {
  const e: Entity = { id: "a", name: "A", role: "target" };
  const now = new Date("2026-10-10T00:00:00Z");
  it("computes rating, shares and a 90 day change from dated reviews", () => {
    const rs = [
      ...Array.from({ length: 6 }, (_, i) => mk("a", 5, "recent", `2026-09-${String(10 + i).padStart(2, "0")}`, i)),
      ...Array.from({ length: 6 }, (_, i) => mk("a", 3, "older", `2026-06-${String(10 + i).padStart(2, "0")}`, 100 + i)),
    ];
    const s = summarizeEntity(e, rs, now);
    expect(s.reviewCount).toBe(12);
    expect(s.avgRating).toBe(4);
    expect(s.change90d).toBe(2);
    expect(s.ratingShare[5]).toBe(6);
    expect(s.trend.map((t) => t.month)).toEqual(["2026-06", "2026-09"]);
  });
  it("gives no change when a window has under 5 reviews", () => {
    expect(summarizeEntity(e, [mk("a", 5, "x", "2026-09-20")], now).change90d).toBeNull();
  });
});

describe("findWeakSpots", () => {
  const entities: Entity[] = [
    { id: "me", name: "Me", role: "target" },
    { id: "them", name: "Them", role: "competitor" },
  ];
  const reviews = [
    ...Array.from({ length: 4 }, (_, i) => mk("them", 1, "Terrible wait, the queue was endless and slow.", undefined, i)),
    ...Array.from({ length: 4 }, (_, i) => mk("me", 5, "No wait at all, quick and easy.", undefined, 10 + i)),
  ];
  it("lists a theme where the competitor is unhappy and the target is not", () => {
    const themes = buildThemes(reviews);
    const spots = findWeakSpots(entities, themes, reviews);
    const w = spots.find((s) => s.themeLabel === "Wait times");
    expect(w).toMatchObject({ competitorId: "them", mentions: 4, avgRating: 1, targetAvgRating: 5 });
    expect(w?.quote?.rating).toBe(1);
  });
  it("needs 3 competitor mentions", () => {
    const few = reviews.filter((r) => r.entityId === "me").concat(reviews.filter((r) => r.entityId === "them").slice(0, 2));
    expect(findWeakSpots(entities, buildThemes(few), few)).toEqual([]);
  });
  it("lists nothing without a target", () => {
    expect(findWeakSpots([entities[1]], buildThemes(reviews), reviews)).toEqual([]);
  });
});

describe("refinement", () => {
  const reviews = demoReviews();
  it("merges themes by index, recomputes counts and keeps the rest", () => {
    const themes = buildThemes(reviews);
    const i = themes.findIndex((t) => t.label === "Price and value");
    const j = themes.findIndex((t) => t.label === "Quality");
    const merged = applyRefinement(themes, [{ label: "Value for money", from: [i, j] }], reviews);
    const t = merged.find((x) => x.label === "Value for money");
    expect(t?.origin).toBe("llm");
    expect(t?.total).toBeGreaterThanOrEqual(Math.max(themes[i].total, themes[j].total));
    expect(merged.find((x) => x.label === "Quality")).toBeUndefined();
    expect(merged.length).toBe(themes.length - 1);
  });
  it("ignores bad indexes and empty labels", () => {
    const themes = buildThemes(reviews);
    expect(applyRefinement(themes, [{ label: "", from: [0] }, { label: "x", from: [999] }], reviews)).toHaveLength(themes.length);
  });
  it("analyze keeps keyword themes when the refiner throws or returns null", async () => {
    const a = await analyze(DEMO_ENTITIES, reviews, async () => { throw new Error("boom"); });
    expect(a.themeMethod).toBe("keywords");
    expect(a.notes.join(" ")).toMatch(/LLM step failed/);
    const b = await analyze(DEMO_ENTITIES, reviews, async () => null);
    expect(b.themeMethod).toBe("keywords");
  });
  it("analyze uses the refiner when it answers", async () => {
    const a = await analyze(DEMO_ENTITIES, reviews, async () => [{ label: "Everything about price", from: [0] }]);
    expect(a.themeMethod).toBe("keywords+llm");
  });
});

describe("demo report", () => {
  it("finds the planted pattern: Copper Kettle is weak on waiting, Tidewater on price", async () => {
    const r = await demoReport();
    expect(r.themeMethod).toBe("keywords");
    const copper = r.weakSpots.filter((w) => w.competitorId.startsWith("copper"));
    const tide = r.weakSpots.filter((w) => w.competitorId.startsWith("tidewater"));
    expect(copper.map((w) => w.themeLabel)).toContain("Wait times");
    expect(tide.map((w) => w.themeLabel)).toContain("Price and value");
    const [me, copperSum] = r.summaries;
    expect(me.change90d).toBeGreaterThan(0);
    expect(copperSum.change90d).toBeLessThan(0);
  });
});
