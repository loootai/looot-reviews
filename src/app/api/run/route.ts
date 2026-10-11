import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute, sessionIdOf } from "@/lib/auth/guard";
import { allowRun } from "@/lib/auth/limits";
import { IS_DEMO, today } from "@/lib/clock";
import { refinerFromEnv } from "@/lib/llm";
import { hasLoootToken, loootFromEnv } from "@/lib/looot";
import { fetchPrices } from "@/lib/prices";
import { buildPlan, runPlan } from "@/lib/runner";
import { serverCapMicros } from "@/lib/serverCap";
import { entitiesFromForm } from "@/lib/sources";
import { saveReport } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** No cap field. The cap is the server's (REVIEWS_SPEND_CAP_USD). A caller that sends one is ignored. */
const Body = z.object({
  target: z.string().min(1),
  competitors: z.string().default(""),
  pages: z.number().int().min(1).max(5),
  /** The most the plan could cost, as quoted to the person, in micro-dollars. A live total above it refuses the run. */
  confirmedMaxMicros: z.number().int().nonnegative(),
});

/**
 * Paid, and it can spend two keys: the looot balance and, when set, the LLM key for the theme step.
 * Needs an admin session and the CSRF token. Limited per session. The cap comes from server config.
 * Refuses in demo mode, without a token, or when the live price rose above the confirmed total.
 */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  if (IS_DEMO) return NextResponse.json({ error: "Demo mode makes no looot call." }, { status: 403 });
  if (!hasLoootToken()) return NextResponse.json({ error: "LOOOT_TOKEN is not set on the server." }, { status: 501 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const entities = entitiesFromForm(parsed.data.target, parsed.data.competitors);
  if (entities.length === 0) return NextResponse.json({ error: "No target found in that text." }, { status: 400 });
  if (!allowRun(await sessionIdOf(req))) return NextResponse.json({ error: "Too many pulls from this session. Wait ten minutes." }, { status: 429, headers: { "Retry-After": "600", "Cache-Control": "no-store" } });
  const cap = serverCapMicros();
  const priced = await fetchPrices();
  const plan = buildPlan(entities, ["google_maps"], parsed.data.pages, priced.prices, cap);
  if (plan.maxMicros > parsed.data.confirmedMaxMicros) return NextResponse.json({ error: "The price changed since you confirmed it. Quote again.", plan }, { status: 409 });
  const report = await runPlan({ entities, sources: ["google_maps"], plan, looot: loootFromEnv(), prices: priced.prices, unpriced: priced.unread, today: today(), refine: refinerFromEnv() });
  saveReport(report);
  return NextResponse.json({ ok: true, reviews: report.reviews.length, spendMicros: report.spendMicros, runs: report.runs });
}
