import { analyze } from "@/lib/analyze";
import { DEMO_TODAY } from "@/lib/clock";
import type { Entity, Report, Review, SourceRun } from "@/lib/types";

/** Invented coffee shops. None of them exists and none of the reviews was written by a person. */
export const DEMO_ENTITIES: Entity[] = [
  { id: "marlow-finch-coffee-harbor-city", name: "Marlow & Finch Coffee", location: "Harbor City", role: "target" },
  { id: "copper-kettle-roasters-harbor-city", name: "Copper Kettle Roasters", location: "Harbor City", role: "competitor" },
  { id: "tidewater-brew-house-harbor-city", name: "Tidewater Brew House", location: "Harbor City", role: "competitor" },
];

type Pool = { pos: string[]; neg: string[] };

const POOLS: Record<string, Pool> = {
  service: {
    pos: ["The baristas remember my order and the staff are genuinely friendly.", "Service was warm and attentive, the manager checked on us twice.", "Everyone behind the counter was helpful and welcoming."],
    neg: ["The staff were rude when I asked about the menu and never apologised.", "Our server ignored us for ten minutes and then got defensive.", "The manager shrugged off a wrong order, really poor service."],
  },
  wait: {
    pos: ["No queue at 8am and my flat white arrived in two minutes.", "Even with a line out the door the wait was short."],
    neg: ["We waited 25 minutes for two lattes, the queue barely moved.", "Slow service every weekend, it took forever to get a simple drip coffee.", "Long wait at the counter and another long wait at the pickup end."],
  },
  price: {
    pos: ["Fair prices for the quality and the loyalty card is worth it.", "Good value, a large coffee and a pastry for under ten dollars."],
    neg: ["Overpriced for what you get, six dollars for a small latte.", "Expensive and they charged me for oat milk without telling me.", "The prices went up again and the cups got smaller."],
  },
  quality: {
    pos: ["The espresso is fresh and tastes properly roasted, no bitterness.", "Delicious croissants, still warm and flaky.", "Quality beans and a careful pour, you can taste the difference."],
    neg: ["My latte was cold and the espresso tasted burnt.", "The pastry case had stale muffins at noon.", "Coffee tasted watery and the milk was scalded."],
  },
  clean: {
    pos: ["Spotless tables and a clean bathroom, which says a lot.", "Clean, tidy and nothing sticky on the counters."],
    neg: ["Tables were dirty and sticky, nobody wiped them while we sat there.", "The bathroom was filthy and smelled bad.", "Dirty cups on the shelves and a smell of old milk."],
  },
  space: {
    pos: ["Cozy atmosphere with plenty of seating and good light for working.", "Relaxed vibe, quiet enough for a call, easy parking out back."],
    neg: ["Far too loud to talk and every seat was taken.", "Crowded and noisy, nowhere to sit with a laptop.", "No parking nearby and the seating is cramped."],
  },
  coldbrew: {
    pos: ["The cold brew on tap is the best in the city.", "Their cold brew is smooth and not too sweet."],
    neg: ["The cold brew was weak and tasted like water.", "Cold brew sold out by lunch again."],
  },
  oatmilk: {
    pos: ["They do oat milk properly, steamed and not split.", "Good oat milk option and no extra charge here."],
    neg: ["The oat milk curdled in my coffee.", "Out of oat milk again, which is the one thing I come for."],
  },
};

interface Profile {
  /** Rating mix for 1 to 5 stars, as weights. */
  ratings: [number, number, number, number, number];
  /** Themes raised in good reviews and in bad ones, with weights. */
  good: Record<string, number>;
  bad: Record<string, number>;
  /** Rating drift per month, applied to the weights so the trend moves over time. */
  drift: number;
  count: number;
}

const PROFILES: Record<string, Profile> = {
  "marlow-finch-coffee-harbor-city": { ratings: [2, 3, 5, 24, 34], good: { service: 4, quality: 4, coldbrew: 3, clean: 2, price: 2, oatmilk: 2 }, bad: { space: 4, price: 2, wait: 1 }, drift: 0.05, count: 44 },
  "copper-kettle-roasters-harbor-city": { ratings: [9, 12, 10, 18, 17], good: { quality: 5, space: 3, coldbrew: 2 }, bad: { wait: 6, clean: 4, service: 2, oatmilk: 1 }, drift: -0.07, count: 40 },
  "tidewater-brew-house-harbor-city": { ratings: [8, 10, 12, 22, 20], good: { space: 4, clean: 3, service: 2, quality: 3 }, bad: { price: 6, service: 4, oatmilk: 2 }, drift: 0, count: 38 },
};

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T extends string | number>(r: () => number, entries: [T, number][]): T {
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [k, w] of entries) if ((x -= w) <= 0) return k;
  return entries[entries.length - 1][0];
}

/** Invented reviews for the invented shops, spread over 14 months. Deterministic, so every screenshot is the same. */
export function demoReviews(): Review[] {
  const out: Review[] = [];
  const end = Date.parse(`${DEMO_TODAY}T00:00:00Z`);
  Object.entries(PROFILES).forEach(([entityId, p], ei) => {
    const r = rng(1000 + ei * 77);
    for (let i = 0; i < p.count; i++) {
      const ageDays = Math.floor(r() * 420);
      const monthsAgo = ageDays / 30;
      const shift = p.drift * (14 - monthsAgo);
      const w = p.ratings.map((x, k) => Math.max(0.3, x + (k >= 3 ? shift * 6 : -shift * 6))) as number[];
      const rating = weighted(r, w.map((x, k) => [k + 1, x] as [number, number]));
      const pos = rating >= 4;
      const mixed = rating === 3;
      const pick = (side: "pos" | "neg", weights: Record<string, number>) => {
        const theme = weighted(r, Object.entries(weights));
        const pool = POOLS[theme][side];
        return pool[Math.floor(r() * pool.length)];
      };
      const parts: string[] = [];
      if (mixed) {
        parts.push(pick("pos", p.good), pick("neg", p.bad));
      } else {
        const weights = pos ? p.good : p.bad;
        parts.push(pick(pos ? "pos" : "neg", weights));
        if (r() < 0.45) parts.push(pick(pos ? "pos" : "neg", weights));
      }
      const day = new Date(end - ageDays * 86_400_000).toISOString().slice(0, 10);
      out.push({ id: `${entityId.split("-")[0]}-${i + 1}`, entityId, source: "google_maps", rating, text: [...new Set(parts)].join(" "), date: day });
    }
  });
  return out;
}

/** The demo report: invented shops, invented reviews, a fixed date and the runs that would have produced them. */
export async function demoReport(): Promise<Report> {
  const reviews = demoReviews();
  const runs: SourceRun[] = [];
  for (const e of DEMO_ENTITIES) {
    runs.push({ entityId: e.id, source: "google_maps", step: "place lookup", jobId: "maps.place.get", endpointId: "serper-places", state: "completed", costMicros: 1000, reviewCount: 0 });
    const n = reviews.filter((r) => r.entityId === e.id).length;
    runs.push({ entityId: e.id, source: "google_maps", step: "reviews page 1", jobId: "maps.place.reviews", endpointId: "serper-reviews", state: "completed", costMicros: 1000, reviewCount: n });
  }
  const analysis = await analyze(DEMO_ENTITIES, reviews, undefined, new Date(`${DEMO_TODAY}T09:00:00Z`));
  return { version: 1, createdAt: `${DEMO_TODAY}T09:00:00.000Z`, mode: "demo", entities: DEMO_ENTITIES, reviews, runs, spendMicros: runs.reduce((n, r) => n + r.costMicros, 0), capMicros: 250_000, ...analysis };
}
