import { LIST_PRICES, REVIEW_ENDPOINTS } from "./sources";
import type { PriceMap } from "./spend";

/** Date the list prices were read from the public catalog. */
export const PRICES_AS_OF = "2026-10-10";

export const ENDPOINT_IDS: string[] = REVIEW_ENDPOINTS;

/** List prices in micro-dollars per call. Used for --dry-run and when the catalog cannot be read. */
export const FALLBACK_PRICES: PriceMap = { ...LIST_PRICES };

export interface PriceResult {
  prices: PriceMap;
  source: "catalog" | "fallback";
  /** Endpoints whose live price could not be read. The runner refuses to call them. */
  unread: string[];
}

interface CatalogItem {
  price?: { state?: string; amountMicros?: number; unit?: string } | null;
}

/** Reads the per-call price in micros from one public catalog item. null when it has no known call price. */
export function priceOfItem(item: CatalogItem | null | undefined): number | null {
  const p = item?.price;
  if (!p || p.state !== "known" || typeof p.amountMicros !== "number" || p.amountMicros < 0) return null;
  if (p.unit && p.unit !== "call") return null;
  return Math.round(p.amountMicros);
}

/** Free, no token. Reads current prices for the given endpoints from the public catalog. */
export async function fetchPrices(endpointIds: string[] = ENDPOINT_IDS, opts: { baseUrl?: string; fetch?: typeof fetch } = {}): Promise<PriceResult> {
  const base = (opts.baseUrl ?? process.env.LOOOT_API_URL ?? "https://api.looot.ai").replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const prices: PriceMap = { ...FALLBACK_PRICES };
  const unread: string[] = [];
  await Promise.all(
    endpointIds.map(async (id) => {
      try {
        const res = await f(`${base}/v1/public-catalog/${encodeURIComponent(id)}`);
        const price = res.ok ? priceOfItem((await res.json()) as CatalogItem) : null;
        if (price === null) unread.push(id);
        else prices[id] = price;
      } catch {
        unread.push(id);
      }
    }),
  );
  return { prices, source: unread.length > 0 ? "fallback" : "catalog", unread };
}
