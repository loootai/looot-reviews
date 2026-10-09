export type SourceId = "google_maps" | "app_store" | "google_play" | "tripadvisor";
export const SOURCE_IDS: SourceId[] = ["google_maps", "app_store", "google_play", "tripadvisor"];

/** A company, place or app. Ids are optional; each one unlocks a source. */
export interface Entity {
  id: string;
  name: string;
  /** City or area, used to find the Google Maps place. */
  location?: string;
  role: "target" | "competitor";
  /** Google Maps place id or cid. With one of these the place lookup call is skipped. */
  placeId?: string;
  cid?: string;
  appStoreId?: string;
  playPackage?: string;
  tripadvisorId?: string;
}

export interface Review {
  id: string;
  entityId: string;
  source: SourceId;
  /** 1 to 5. */
  rating: number;
  text: string;
  title?: string;
  /** ISO day. undefined when the provider gave no usable date. */
  date?: string;
}

export type RunState = "completed" | "failed" | "pending" | "skipped" | "blocked";

export interface SourceRun {
  entityId: string;
  source: SourceId;
  /** What this call did: "place lookup", "reviews page 2". */
  step: string;
  jobId: string;
  endpointId: string;
  state: RunState;
  runId?: string;
  costMicros: number;
  reviewCount: number;
  message?: string;
}

export interface Quote {
  text: string;
  /** The theme's example quote. */
  entityId: string;
  rating: number;
  source: SourceId;
  date?: string;
}

export interface ThemeEntityStats {
  count: number;
  avgRating: number;
  negative: number;
  positive: number;
}

export interface Theme {
  id: string;
  label: string;
  /** Words and phrases that put a review in this theme. */
  keywords: string[];
  /** "named" themes come from config/themes.json. "found" themes come from n-gram clustering. */
  origin: "named" | "found" | "llm";
  total: number;
  /** Share of all reviews that mention the theme. */
  share: number;
  avgRating: number;
  byEntity: Record<string, ThemeEntityStats>;
  quotes: Quote[];
}

export interface TrendPoint {
  month: string;
  count: number;
  avgRating: number;
}

export interface EntitySummary {
  entityId: string;
  reviewCount: number;
  avgRating: number | null;
  /** Average of the last 90 days minus the 90 days before. null when either window has under 5 reviews. */
  change90d: number | null;
  bySource: Partial<Record<SourceId, number>>;
  ratingShare: Record<1 | 2 | 3 | 4 | 5, number>;
  trend: TrendPoint[];
}

export interface WeakSpot {
  themeId: string;
  themeLabel: string;
  competitorId: string;
  mentions: number;
  avgRating: number;
  /** The target's average on the same theme, or null when the target has under 3 mentions of it. */
  targetAvgRating: number | null;
  targetMentions: number;
  /** Why this is listed. */
  reason: string;
  quote?: Quote;
}

export interface Report {
  version: 1;
  createdAt: string;
  mode: "demo" | "live";
  entities: Entity[];
  reviews: Review[];
  runs: SourceRun[];
  spendMicros: number;
  capMicros: number;
  themes: Theme[];
  summaries: EntitySummary[];
  weakSpots: WeakSpot[];
  /** "keywords" when no LLM step ran. */
  themeMethod: "keywords" | "keywords+llm";
  notes: string[];
}
