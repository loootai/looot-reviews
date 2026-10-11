import { firstPlace, nextPageToken, parseReviews } from "./normalize";
import type { Entity, Review, SourceId } from "./types";

/** What a source adapter needs from the runner to make one priced call. */
export interface CallSpec {
  step: string;
  endpointId: string;
  jobId: string;
  input: Record<string, unknown>;
}

export type CallOutcome<T> = { ok: true; value: T } | { ok: false };

export interface CallCtx {
  today: string;
  pages: number;
  /** Makes one guarded, idempotent, priced call. `parse` turns the result into what the adapter wants; `count` is how many reviews that holds. */
  call<T>(spec: CallSpec, parse: (result: unknown) => T, count: (v: T) => number): Promise<CallOutcome<T>>;
}

export interface CallLine {
  step: string;
  endpointId: string;
  jobId: string;
  /** The most calls this step can make. Pages after the first happen only when the provider says there are more. */
  maxCalls: number;
  /** The input of the first call when it is known before the run. Lets the quote see that a stored answer exists. */
  firstInput?: Record<string, unknown>;
}

export interface SourceDef {
  id: SourceId;
  label: string;
  /** true when the entity has what this source needs. */
  applies(e: Entity): boolean;
  /** The calls a run can make for this entity, for the quote. */
  lines(e: Entity, pages: number): CallLine[];
  collect(e: Entity, ctx: CallCtx): Promise<Review[]>;
}

/** List prices in micro-dollars per call, read from the public looot catalog on 2026-10-10. */
export const LIST_PRICES: Record<string, number> = {
  "serper-places": 1000,
  "serper-reviews": 1000,
  "searchapi-io-apple-product-reviews": 4000,
  "anysite-api-google-play-apps-reviews": 35970,
  "searchapi-io-tripadvisor-reviews": 4000,
};

export const REVIEW_ENDPOINTS = Object.keys(LIST_PRICES);

const googleReviewInput = (e: Entity, token?: string): Record<string, unknown> => ({
  ...(e.cid ? { cid: e.cid } : { placeId: e.placeId }),
  sortBy: "newest",
  hl: "en",
  ...(token ? { nextPageToken: token } : {}),
});

/** Input of the Google Maps place lookup. No date in it, so its key is the same on every day. */
const placeLookupInput = (e: Entity): Record<string, unknown> => ({ q: [e.name, e.location].filter(Boolean).join(" "), num: 1 });

/** Pages through a provider that numbers its pages. Stops on an empty page or a refused call. */
async function numberedPages(e: Entity, ctx: CallCtx, source: SourceId, endpointId: string, jobId: string, input: Record<string, unknown>): Promise<Review[]> {
  const out: Review[] = [];
  for (let page = 1; page <= ctx.pages; page++) {
    const r = await ctx.call({ step: `reviews page ${page}`, endpointId, jobId, input: { ...input, page } }, (res) => parseReviews(res, { entityId: e.id, source, today: ctx.today }), (v) => v.length);
    if (!r.ok || r.value.length === 0) break;
    out.push(...r.value);
  }
  return out;
}

/**
 * The review sources this repo reads. Edit this table to change the endpoint behind a source.
 * Trustpilot and G2 are not here: looot has no endpoint for either.
 */
export const SOURCE_DEFS: SourceDef[] = [
  {
    id: "google_maps",
    label: "Google Maps",
    applies: (e) => Boolean(e.name || e.placeId || e.cid),
    lines: (e, pages) => [
      ...(e.placeId || e.cid ? [] : [{ step: "place lookup", endpointId: "serper-places", jobId: "maps.place.get", maxCalls: 1, firstInput: placeLookupInput(e) }]),
      { step: "reviews", endpointId: "serper-reviews", jobId: "maps.place.reviews", maxCalls: pages, ...(e.placeId || e.cid ? { firstInput: googleReviewInput(e) } : {}) },
    ],
    async collect(e, ctx) {
      let target = e;
      if (!e.placeId && !e.cid) {
        const found = await ctx.call({ step: "place lookup", endpointId: "serper-places", jobId: "maps.place.get", input: placeLookupInput(e) }, firstPlace, () => 0);
        if (!found.ok || !found.value) return [];
        target = { ...e, cid: found.value.cid, placeId: found.value.placeId };
      }
      const out: Review[] = [];
      let token: string | undefined;
      for (let page = 1; page <= ctx.pages; page++) {
        const r = await ctx.call(
          { step: `reviews page ${page}`, endpointId: "serper-reviews", jobId: "maps.place.reviews", input: googleReviewInput(target, token) },
          (res) => ({ reviews: parseReviews(res, { entityId: e.id, source: "google_maps", today: ctx.today }), next: nextPageToken(res) }),
          (v) => v.reviews.length,
        );
        if (!r.ok || r.value.reviews.length === 0) break;
        out.push(...r.value.reviews);
        token = r.value.next;
        if (!token) break;
      }
      return out;
    },
  },
  {
    id: "app_store",
    label: "App Store",
    applies: (e) => Boolean(e.appStoreId),
    lines: (e, pages) => [{ step: "reviews", endpointId: "searchapi-io-apple-product-reviews", jobId: "reviews.appstore.reviews", maxCalls: pages, firstInput: { product_id: e.appStoreId, country: "us", page: 1 } }],
    collect: (e, ctx) => numberedPages(e, ctx, "app_store", "searchapi-io-apple-product-reviews", "reviews.appstore.reviews", { product_id: e.appStoreId, country: "us" }),
  },
  {
    id: "google_play",
    label: "Google Play",
    applies: (e) => Boolean(e.playPackage),
    lines: (e, pages) => [{ step: "reviews", endpointId: "anysite-api-google-play-apps-reviews", jobId: "api.google.play.apps.reviews", maxCalls: 1, firstInput: { package: e.playPackage, count: Math.min(100, pages * 20), sort: "newest" } }],
    async collect(e, ctx) {
      const r = await ctx.call(
        { step: "reviews", endpointId: "anysite-api-google-play-apps-reviews", jobId: "api.google.play.apps.reviews", input: { package: e.playPackage, count: Math.min(100, ctx.pages * 20), sort: "newest" } },
        (res) => parseReviews(res, { entityId: e.id, source: "google_play", today: ctx.today }),
        (v) => v.length,
      );
      return r.ok ? r.value : [];
    },
  },
  {
    id: "tripadvisor",
    label: "Tripadvisor",
    applies: (e) => Boolean(e.tripadvisorId),
    lines: (e, pages) => [{ step: "reviews", endpointId: "searchapi-io-tripadvisor-reviews", jobId: "search.tripadvisor-reviews", maxCalls: pages, firstInput: { place_id: e.tripadvisorId, page: 1 } }],
    collect: (e, ctx) => numberedPages(e, ctx, "tripadvisor", "searchapi-io-tripadvisor-reviews", "search.tripadvisor-reviews", { place_id: e.tripadvisorId }),
  },
];

/** "Blue Door Cafe @ Austin TX" to an entity. The part after @ is the location. */
export function parseEntity(raw: string, role: Entity["role"]): Entity | null {
  const [namePart, locPart] = raw.split("@").map((s) => s.trim());
  if (!namePart) return null;
  const id = [namePart, locPart].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { id, name: namePart, location: locPart || undefined, role };
}

/** Turns the form text into entities. The target comes first; competitors are separated by semicolons or new lines. */
export function entitiesFromForm(target: string, competitors: string): Entity[] {
  const t = parseEntity(target, "target");
  const rivals = competitors.split(/[;\n]/).map((s) => parseEntity(s, "competitor")).filter((e): e is Entity => e !== null);
  return t ? [t, ...rivals] : [];
}
