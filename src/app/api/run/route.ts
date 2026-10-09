import { NextResponse } from "next/server";
import { z } from "zod";
import { IS_DEMO, today } from "@/lib/clock";
import { refinerFromEnv } from "@/lib/llm";
import { hasLoootToken, loootFromEnv } from "@/lib/looot";
import { fetchPrices } from "@/lib/prices";
import { buildPlan, runPlan } from "@/lib/runner";
import { entitiesFromForm } from "@/lib/sources";
import { parseCapUsd } from "@/lib/spend";
import { saveReport } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  target: z.string().min(1),
  competitors: z.string().default(""),
  pages: z.number().int().min(1).max(5),
  maxSpendUsd: z.union([z.string(), z.number()]),
  /** The most the plan could cost, as quoted to the person, in micro-dollars. A live total above it refuses the run. */
  confirmedMaxMicros: z.number().int().nonnegative(),
});

/** Paid. The web form reads Google Maps only; the CLI and the config file add the other sources. Refuses in demo mode, without a token, or when the live price rose above the confirmed total. */
export async function POST(req: Request) {
  if (IS_DEMO) return NextResponse.json({ error: "Demo mode makes no looot call." }, { status: 403 });
  if (!hasLoootToken()) return NextResponse.json({ error: "LOOOT_TOKEN is not set on the server." }, { status: 501 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const entities = entitiesFromForm(parsed.data.target, parsed.data.competitors);
  let cap: number;
  try {
    cap = parseCapUsd(parsed.data.maxSpendUsd);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const priced = await fetchPrices();
  const plan = buildPlan(entities, ["google_maps"], parsed.data.pages, priced.prices, cap);
  if (plan.maxMicros > parsed.data.confirmedMaxMicros) return NextResponse.json({ error: "The price changed since you confirmed it. Quote again.", plan }, { status: 409 });
  const report = await runPlan({ entities, sources: ["google_maps"], plan, looot: loootFromEnv(), prices: priced.prices, unpriced: priced.unread, today: today(), refine: refinerFromEnv() });
  saveReport(report);
  return NextResponse.json({ ok: true, reviews: report.reviews.length, spendMicros: report.spendMicros, runs: report.runs });
}
