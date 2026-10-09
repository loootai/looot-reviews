import themeConfig from "../../config/themes.json";
import { lightStem, makeMatcher, quoteAround, STOP_WORDS, tokenize } from "./text";
import type { Entity, EntitySummary, Report, Review, Theme, ThemeEntityStats, TrendPoint, WeakSpot, Quote } from "./types";

interface ThemeConfig {
  minMentions: number;
  themes: Record<string, string[]>;
}
const DEFAULT_CONFIG = themeConfig as unknown as ThemeConfig;

/** An optional step that merges and renames themes. It gets the keyword themes and returns groups of theme indexes with a new label. */
export type Refiner = (themes: Theme[]) => Promise<{ label: string; from: number[] }[] | null>;

export interface Analysis {
  themes: Theme[];
  summaries: EntitySummary[];
  weakSpots: WeakSpot[];
  themeMethod: Report["themeMethod"];
  notes: string[];
}

const textOf = (r: Review) => (r.title && !r.text.includes(r.title) ? `${r.title}. ${r.text}` : r.text);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0);

/** Counts, average rating and negative and positive mentions for the reviews of one theme, split by entity. */
export function statsFor(reviews: Review[]): { total: number; avgRating: number; byEntity: Record<string, ThemeEntityStats> } {
  const byEntity: Record<string, ThemeEntityStats> = {};
  const groups = new Map<string, Review[]>();
  for (const r of reviews) groups.set(r.entityId, [...(groups.get(r.entityId) ?? []), r]);
  for (const [id, rs] of groups) byEntity[id] = { count: rs.length, avgRating: mean(rs.map((r) => r.rating)), negative: rs.filter((r) => r.rating <= 2).length, positive: rs.filter((r) => r.rating >= 4).length };
  return { total: reviews.length, avgRating: mean(reviews.map((r) => r.rating)), byEntity };
}

/** Up to three quotes for a set of matching reviews: the lowest rated, the highest rated and a middle one, from different entities when possible. */
export function pickQuotes(reviews: Review[], test: (t: string) => boolean): Quote[] {
  const usable = reviews.map((r) => ({ r, q: quoteAround(textOf(r), test) })).filter((x) => x.q.length >= 25);
  if (usable.length === 0) return [];
  const sorted = [...usable].sort((a, b) => a.r.rating - b.r.rating || a.q.length - b.q.length);
  const picks = [sorted[0], sorted[sorted.length - 1], sorted[Math.floor(sorted.length / 2)]];
  const out: typeof usable = [];
  for (const p of picks) if (!out.some((o) => o.q === p.q)) out.push(p);
  return out.map((x) => ({ text: x.q, entityId: x.r.entityId, rating: x.r.rating, source: x.r.source, date: x.r.date }));
}

function buildTheme(id: string, label: string, keywords: string[], origin: Theme["origin"], all: Review[]): Theme | null {
  const test = makeMatcher(keywords);
  const hits = all.filter((r) => test(textOf(r)));
  if (hits.length === 0) return null;
  const s = statsFor(hits);
  return { id, label, keywords, origin, share: Math.round((hits.length / all.length) * 1000) / 1000, quotes: pickQuotes(hits, test), ...s };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Phrases (single words and adjacent word pairs) that many reviews share, merged into themes by overlap. No model. */
export function findPhraseThemes(reviews: Review[], taken: (phrase: string) => boolean, opts: { max?: number; minDf?: number } = {}): { label: string; keywords: string[] }[] {
  const n = reviews.length;
  if (n < 6) return [];
  const minDf = opts.minDf ?? Math.max(3, Math.ceil(n * 0.03));
  const docs = new Map<string, Set<number>>();
  reviews.forEach((r, i) => {
    const toks = tokenize(textOf(r));
    const content = toks.map((t) => (STOP_WORDS.has(t) || t.length < 3 ? null : lightStem(t)));
    const seen = new Set<string>();
    for (let k = 0; k < content.length; k++) {
      const a = content[k];
      if (!a) continue;
      if (a.length >= 4) seen.add(a);
      const b = content[k + 1];
      if (b) seen.add(`${a} ${b}`);
    }
    for (const p of seen) docs.set(p, (docs.get(p) ?? new Set()).add(i));
  });
  const cands = [...docs.entries()]
    .filter(([p, d]) => d.size >= minDf && d.size <= n * 0.6 && !taken(p))
    .map(([p, d]) => ({ p, d, score: d.size * (p.includes(" ") ? 1.5 : 1) }))
    .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))
    .slice(0, 60);
  const clusters: { docs: Set<number>; phrases: { p: string; df: number }[] }[] = [];
  for (const c of cands) {
    const home = clusters.find((cl) => {
      const inter = [...c.d].filter((x) => cl.docs.has(x)).length;
      const union = cl.docs.size + c.d.size - inter;
      return inter / union >= 0.4 || inter / c.d.size >= 0.8;
    });
    if (home) {
      home.phrases.push({ p: c.p, df: c.d.size });
      for (const x of c.d) home.docs.add(x);
    } else clusters.push({ docs: new Set(c.d), phrases: [{ p: c.p, df: c.d.size }] });
  }
  return clusters
    .sort((a, b) => b.docs.size - a.docs.size)
    .slice(0, opts.max ?? 6)
    .map((cl) => {
      const lead = [...cl.phrases].sort((a, b) => Number(b.p.includes(" ")) - Number(a.p.includes(" ")) || b.df - a.df)[0].p;
      return { label: lead.charAt(0).toUpperCase() + lead.slice(1), keywords: cl.phrases.map((x) => x.p) };
    });
}

/** Named themes from config, then found themes from repeated phrases, with counts and quotes. */
export function buildThemes(reviews: Review[], config: ThemeConfig = DEFAULT_CONFIG): Theme[] {
  if (reviews.length === 0) return [];
  const named: Theme[] = [];
  for (const [label, kws] of Object.entries(config.themes)) {
    const t = buildTheme(slug(label), label, kws, "named", reviews);
    if (t && t.total >= config.minMentions) named.push(t);
  }
  const allNamed = makeMatcher(Object.values(config.themes).flat());
  const found: Theme[] = [];
  for (const f of findPhraseThemes(reviews, (p) => allNamed(p))) {
    const t = buildTheme(`found-${slug(f.label)}`, f.label, f.keywords, "found", reviews);
    if (t && t.total >= config.minMentions && !named.some((x) => x.label.toLowerCase() === t.label.toLowerCase())) found.push(t);
  }
  return [...named, ...found].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Applies the groups an optional refiner returned. Keywords of merged themes are unioned and the stats are recomputed. */
export function applyRefinement(themes: Theme[], groups: { label: string; from: number[] }[], reviews: Review[]): Theme[] {
  const used = new Set<number>();
  const out: Theme[] = [];
  for (const g of groups) {
    const members = [...new Set(g.from)].filter((i) => Number.isInteger(i) && i >= 0 && i < themes.length && !used.has(i));
    if (members.length === 0 || !g.label.trim()) continue;
    members.forEach((i) => used.add(i));
    const t = buildTheme(`llm-${slug(g.label)}`, g.label.trim(), members.flatMap((i) => themes[i].keywords), "llm", reviews);
    if (t) out.push(t);
  }
  themes.forEach((t, i) => { if (!used.has(i)) out.push(t); });
  return out.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

const DAY = 86_400_000;

/** Rating by month, overall numbers, and the change over the last 90 days against the 90 before. */
export function summarizeEntity(entity: Entity, reviews: Review[], now: Date): EntitySummary {
  const mine = reviews.filter((r) => r.entityId === entity.id);
  const months = new Map<string, number[]>();
  for (const r of mine) if (r.date) months.set(r.date.slice(0, 7), [...(months.get(r.date.slice(0, 7)) ?? []), r.rating]);
  const trend: TrendPoint[] = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rs]) => ({ month, count: rs.length, avgRating: mean(rs) }));
  const t = now.getTime();
  const win = (from: number, to: number) => mine.filter((r) => r.date && Date.parse(r.date) > t - to * DAY && Date.parse(r.date) <= t - from * DAY).map((r) => r.rating);
  const recent = win(0, 90);
  const before = win(90, 180);
  const bySource: EntitySummary["bySource"] = {};
  const ratingShare = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as EntitySummary["ratingShare"];
  for (const r of mine) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    ratingShare[r.rating as 1]++;
  }
  return { entityId: entity.id, reviewCount: mine.length, avgRating: mine.length ? mean(mine.map((r) => r.rating)) : null, change90d: recent.length >= 5 && before.length >= 5 ? Math.round((mean(recent) - mean(before)) * 100) / 100 : null, bySource, ratingShare, trend };
}

/** Themes where a competitor's reviewers are unhappy and the target's are not, or the target is rarely mentioned. */
export function findWeakSpots(entities: Entity[], themes: Theme[], reviews: Review[]): WeakSpot[] {
  const target = entities.find((e) => e.role === "target");
  if (!target) return [];
  const out: WeakSpot[] = [];
  for (const c of entities.filter((e) => e.role === "competitor")) {
    for (const t of themes) {
      const s = t.byEntity[c.id];
      if (!s || s.count < 3) continue;
      if (!(s.avgRating <= 3 || s.negative / s.count >= 0.4)) continue;
      const mine = t.byEntity[target.id];
      const targetAvg = mine && mine.count >= 3 ? mine.avgRating : null;
      if (targetAvg !== null && targetAvg - s.avgRating < 0.5) continue;
      const test = makeMatcher(t.keywords);
      const worst = reviews.filter((r) => r.entityId === c.id && test(textOf(r))).sort((a, b) => a.rating - b.rating)[0];
      out.push({
        themeId: t.id,
        themeLabel: t.label,
        competitorId: c.id,
        mentions: s.count,
        avgRating: s.avgRating,
        targetAvgRating: targetAvg,
        targetMentions: mine?.count ?? 0,
        reason: targetAvg !== null ? `Reviewers average ${s.avgRating} on this theme. Yours average ${targetAvg}.` : `Reviewers average ${s.avgRating} on this theme across ${s.count} mentions. Your reviews rarely raise it.`,
        quote: worst ? { text: quoteAround(textOf(worst), test), entityId: c.id, rating: worst.rating, source: worst.source, date: worst.date } : undefined,
      });
    }
  }
  const gap = (w: WeakSpot) => (w.targetAvgRating === null ? 3 - w.avgRating : w.targetAvgRating - w.avgRating) * Math.log2(w.mentions + 1);
  return out.sort((a, b) => gap(b) - gap(a)).slice(0, 12);
}

/** Everything the board shows, computed from the reviews. The refiner is optional; without it nothing leaves the machine. */
export async function analyze(entities: Entity[], reviews: Review[], refine?: Refiner, now: Date = new Date()): Promise<Analysis> {
  const notes: string[] = [];
  let themes = buildThemes(reviews);
  let themeMethod: Analysis["themeMethod"] = "keywords";
  if (refine && themes.length > 1) {
    try {
      const groups = await refine(themes);
      if (groups && groups.length > 0) {
        themes = applyRefinement(themes, groups, reviews);
        themeMethod = "keywords+llm";
      } else notes.push("The optional LLM step returned nothing usable. Themes are keyword themes.");
    } catch (e) {
      notes.push(`The optional LLM step failed (${(e as Error).message}). Themes are keyword themes.`);
    }
  }
  if (reviews.length > 0 && reviews.length < 30) notes.push(`Only ${reviews.length} reviews. Themes and weak spots on this few are weak evidence.`);
  return { themes, summaries: entities.map((e) => summarizeEntity(e, reviews, now)), weakSpots: findWeakSpots(entities, themes, reviews), themeMethod, notes };
}
