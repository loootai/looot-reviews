import { describe, expect, it } from "vitest";
import { findReviewArray, firstPlace, nextPageToken, parseReviews, relativeToDay, toRating } from "./normalize";

const ctx = { entityId: "e", source: "google_maps" as const, today: "2026-10-10" };

describe("toRating", () => {
  it("reads numbers, strings and objects, and rounds to 1 to 5", () => {
    expect(toRating(5)).toBe(5);
    expect(toRating("4 stars")).toBe(4);
    expect(toRating("3,5")).toBe(4);
    expect(toRating({ value: 2 })).toBe(2);
  });
  it("rejects what is not a rating", () => {
    expect(toRating(0)).toBeUndefined();
    expect(toRating(9)).toBeUndefined();
    expect(toRating("great")).toBeUndefined();
    expect(toRating(null)).toBeUndefined();
  });
});

describe("relativeToDay", () => {
  it("counts back from today", () => {
    expect(relativeToDay("3 months ago", "2026-10-10")).toBe("2026-07-12");
    expect(relativeToDay("a week ago", "2026-10-10")).toBe("2026-10-03");
    expect(relativeToDay("2 years ago", "2026-10-10")).toBe("2024-10-10");
    expect(relativeToDay("Edited a month ago", "2026-10-10")).toBe("2026-09-10");
    expect(relativeToDay("sometime", "2026-10-10")).toBeUndefined();
  });
});

describe("parseReviews", () => {
  it("maps a Serper-style Google Maps review list", () => {
    const rs = parseReviews({ reviews: [{ rating: 5, snippet: "Lovely staff and fresh coffee.", date: "a month ago", isoDate: "2026-09-08T10:00:00Z", user: { name: "Someone" } }, { rating: 1, snippet: "Waited forever.", date: "2 weeks ago" }], nextPageToken: "abc" }, ctx);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({ rating: 5, date: "2026-09-08", source: "google_maps" });
    expect(rs[1].date).toBe("2026-09-26");
  });
  it("does not keep the reviewer's name", () => {
    const [r] = parseReviews([{ rating: 4, text: "Good.", user: { name: "Jane Roe" }, author: "Jane Roe" }], ctx);
    expect(JSON.stringify(r)).not.toContain("Jane");
  });
  it("maps an App Store style row with a title and nested wrapper", () => {
    const rs = parseReviews({ data: { reviews: [{ id: 77, title: "Crashes on launch", text: "Since the update it crashes.", rating: "1", date: "2026-08-01" }] } }, { ...ctx, source: "app_store" });
    expect(rs[0]).toMatchObject({ id: "77", title: "Crashes on launch", rating: 1, date: "2026-08-01" });
  });
  it("uses the title when there is no body, and skips rows with no rating or no text", () => {
    const rs = parseReviews([{ rating: 3, title: "Fine" }, { rating: 3 }, { text: "no rating" }], ctx);
    expect(rs).toHaveLength(1);
    expect(rs[0].text).toBe("Fine");
  });
  it("dedupes by id", () => {
    expect(parseReviews([{ id: "a", rating: 5, text: "x" }, { id: "a", rating: 5, text: "x" }], ctx)).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("finds nested lists and tokens", () => {
    expect(findReviewArray({ results: { reviews: [{ a: 1 }] } })).toHaveLength(1);
    expect(nextPageToken({ nextPageToken: "t" })).toBe("t");
    expect(nextPageToken({ pagination: { next_page_token: "u" } })).toBe("u");
    expect(nextPageToken({})).toBeUndefined();
  });
  it("reads the first place from a places answer", () => {
    expect(firstPlace({ places: [{ title: "A", cid: 123, placeId: "ChIJ1" }] })).toEqual({ cid: "123", placeId: "ChIJ1", title: "A" });
    expect(firstPlace({ places: [{ title: "No ids" }] })).toBeNull();
    expect(firstPlace({})).toBeNull();
  });
});
