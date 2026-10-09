import { createHash } from "node:crypto";
import type { Review, SourceId } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const LIST_KEYS = ["reviews", "results", "data", "items", "comments", "user_reviews", "review_list", "response"];

/** Finds the list of reviews in a provider response, in the body or under the usual wrapper keys, up to three levels deep. */
export function findReviewArray(result: unknown, depth = 0): Obj[] {
  if (Array.isArray(result)) return result.filter(isObj);
  if (!isObj(result) || depth > 3) return [];
  for (const k of LIST_KEYS) {
    const v = result[k];
    if (Array.isArray(v) && v.some(isObj)) return v.filter(isObj);
  }
  for (const k of LIST_KEYS) {
    if (isObj(result[k])) {
      const inner = findReviewArray(result[k], depth + 1);
      if (inner.length > 0) return inner;
    }
  }
  return [];
}

/** The token that asks for the next page, when the provider gave one. */
export function nextPageToken(result: unknown): string | undefined {
  if (!isObj(result)) return undefined;
  for (const k of ["nextPageToken", "next_page_token", "next_token", "nextToken", "continuation_token"]) {
    const v = result[k];
    if (typeof v === "string" && v) return v;
  }
  const pag = result.serpapi_pagination ?? result.pagination;
  if (isObj(pag)) return nextPageToken(pag);
  return undefined;
}

/** "3 months ago", "a week ago", "2 years ago" to an ISO day, counted back from `today`. */
export function relativeToDay(text: string, today: string): string | undefined {
  const m = /^(?:edited\s+)?(a|an|\d+)\s+(day|week|month|year|hour|minute)s?\s+ago/i.exec(text.trim());
  if (!m) return /^(just now|today)/i.test(text.trim()) ? today : undefined;
  const n = m[1].toLowerCase().startsWith("a") ? 1 : Number(m[1]);
  const per = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase() as "day"];
  return new Date(Date.parse(`${today}T00:00:00Z`) - n * per * 86_400_000).toISOString().slice(0, 10);
}

function toDay(v: unknown, today: string): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  let ms: number | undefined;
  if (typeof v === "number") ms = v < 1e11 ? v * 1000 : v;
  else if (typeof v === "string") {
    const rel = relativeToDay(v, today);
    if (rel) return rel;
    ms = /^\d{9,13}$/.test(v) ? (Number(v) < 1e11 ? Number(v) * 1000 : Number(v)) : Date.parse(v);
  }
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  if (d.getUTCFullYear() < 2005 || d.getUTCFullYear() > 2100) return undefined;
  return d.toISOString().slice(0, 10);
}

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
}

/** "5", 4.5, "4 stars", "5/5", { value: 4 } to a 1 to 5 whole rating. undefined when it is not a rating. */
export function toRating(v: unknown): number | undefined {
  if (isObj(v)) return toRating(pick(v, ["value", "rating", "score"]));
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v.replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(n) || n < 0.5 || n > 5.49) return undefined;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (isObj(v)) return str(pick(v, ["text", "original", "translated", "content"]));
  return undefined;
}

const DATE_KEYS = ["isoDate", "iso_date", "published_at", "publishedAtDate", "review_date", "date", "published", "posted_at", "created_at", "updated", "time", "at", "timestamp"];

/** Maps one provider response to review rows. A row needs a rating and some text or a title; anything else is skipped. */
export function parseReviews(result: unknown, ctx: { entityId: string; source: SourceId; today: string }): Review[] {
  const out: Review[] = [];
  const seen = new Set<string>();
  for (const raw of findReviewArray(result)) {
    const rating = toRating(pick(raw, ["rating", "stars", "score", "star_rating", "rate", "review_rating", "user_rating"]));
    const title = str(pick(raw, ["title", "headline", "review_title"]));
    const text = str(pick(raw, ["snippet", "text", "content", "body", "review", "review_text", "comment", "description", "extracted_snippet"])) ?? title;
    if (rating === undefined || !text) continue;
    const date = toDay(pick(raw, DATE_KEYS), ctx.today);
    const rawId = pick(raw, ["review_id", "reviewId", "id"]);
    const providerId = typeof rawId === "number" ? String(rawId) : str(rawId);
    const id = providerId ?? createHash("sha1").update(`${ctx.source}|${text}|${date ?? ""}|${rating}`).digest("hex").slice(0, 12);
    const key = `${ctx.source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, entityId: ctx.entityId, source: ctx.source, rating, text, title: title && title !== text ? title : undefined, date });
  }
  return out;
}

/** The first Google Maps place in a Serper places or maps answer: its ids, name and rating. */
export function firstPlace(result: unknown): { cid?: string; placeId?: string; title?: string } | null {
  if (!isObj(result)) return null;
  const list = findPlaces(result);
  const p = list[0];
  if (!p) return null;
  const cid = pick(p, ["cid"]);
  const placeId = pick(p, ["placeId", "place_id"]);
  if (cid === undefined && placeId === undefined) return null;
  return { cid: cid === undefined ? undefined : String(cid), placeId: placeId === undefined ? undefined : String(placeId), title: str(p.title) };
}

function findPlaces(o: Obj): Obj[] {
  for (const k of ["places", "local_results", "results", "data"]) {
    const v = o[k];
    if (Array.isArray(v) && v.some(isObj)) return v.filter(isObj);
    if (isObj(v)) { const inner = findPlaces(v); if (inner.length) return inner; }
  }
  return [];
}
