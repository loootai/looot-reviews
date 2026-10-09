import { describe, expect, it } from "vitest";
import { parseGroups, refinerFromEnv } from "./llm";
import type { Theme } from "./types";

const theme = (label: string): Theme => ({ id: label, label, keywords: [label.toLowerCase()], origin: "named", total: 3, share: 0.1, avgRating: 3, byEntity: {}, quotes: [{ text: "A quote about it.", entityId: "e", rating: 3, source: "google_maps" }] });

describe("refinerFromEnv", () => {
  it("is off without both variables", () => {
    expect(refinerFromEnv({})).toBeUndefined();
    expect(refinerFromEnv({ REVIEWS_LLM_API_KEY: "k" })).toBeUndefined();
    expect(refinerFromEnv({ REVIEWS_LLM_MODEL: "m" })).toBeUndefined();
  });
  it("sends labels and quotes, not the review set, and parses the answer", async () => {
    let sent = "";
    let url = "";
    const f = (async (u: string, init: RequestInit) => {
      url = u;
      sent = String(init.body);
      return new Response(JSON.stringify({ content: [{ type: "text", text: 'Here you go: {"groups":[{"label":"Cost","from":[0,1]}]}' }] }));
    }) as unknown as typeof fetch;
    const refine = refinerFromEnv({ REVIEWS_LLM_API_KEY: "k", REVIEWS_LLM_MODEL: "some-model", REVIEWS_LLM_BASE_URL: "https://llm.example.invalid/" }, f);
    const groups = await refine?.([theme("Price"), theme("Fees")]);
    expect(groups).toEqual([{ label: "Cost", from: [0, 1] }]);
    expect(url).toBe("https://llm.example.invalid/v1/messages");
    expect(sent).toContain("A quote about it.");
    expect(sent).toContain("some-model");
  });
  it("throws on an HTTP error so analyze can fall back", async () => {
    const f = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(refinerFromEnv({ REVIEWS_LLM_API_KEY: "k", REVIEWS_LLM_MODEL: "m" }, f)?.([theme("A")])).rejects.toThrow(/HTTP 500/);
  });
});

describe("parseGroups", () => {
  it("handles fences and junk", () => {
    expect(parseGroups('```json\n{"groups":[{"label":"A","from":[1]}]}\n```')).toEqual([{ label: "A", from: [1] }]);
    expect(parseGroups("nothing")).toBeNull();
    expect(parseGroups('{"groups":[{"label":3}]}')).toBeNull();
    expect(parseGroups("{broken")).toBeNull();
  });
});
