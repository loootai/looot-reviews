import { describe, expect, it } from "vitest";
import { ENDPOINT_IDS, FALLBACK_PRICES, fetchPrices, priceOfItem } from "./prices";

describe("prices", () => {
  it("reads a known per-call price and rejects the rest", () => {
    expect(priceOfItem({ price: { state: "known", amountMicros: 1000, unit: "call" } })).toBe(1000);
    expect(priceOfItem({ price: { state: "unknown" } })).toBeNull();
    expect(priceOfItem({ price: { state: "known", amountMicros: 5, unit: "row" } })).toBeNull();
  });
  it("uses the catalog price and lists what it could not read", async () => {
    const f = (async (url: string) => {
      if (url.endsWith("/serper-reviews")) return new Response(JSON.stringify({ price: { state: "known", amountMicros: 1500, unit: "call" } }));
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await fetchPrices(["serper-reviews", "serper-places"], { fetch: f });
    expect(r.prices["serper-reviews"]).toBe(1500);
    expect(r.unread).toEqual(["serper-places"]);
    expect(r.source).toBe("fallback");
  });
  it("has a fallback price for every endpoint", () => {
    for (const id of ENDPOINT_IDS) expect(FALLBACK_PRICES[id]).toBeGreaterThan(0);
  });
});
