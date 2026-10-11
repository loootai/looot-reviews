import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/auth/guard";
import { IS_DEMO } from "@/lib/clock";
import { FALLBACK_PRICES, PRICES_AS_OF, fetchPrices } from "@/lib/prices";
import { buildPlan } from "@/lib/runner";
import { serverCapMicros } from "@/lib/serverCap";
import { entitiesFromForm } from "@/lib/sources";
import { SOURCE_IDS } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  target: z.string().min(1),
  competitors: z.string().default(""),
  pages: z.number().int().min(1).max(5).default(2),
});

/** Free. Returns the calls a pull can make and the most it can cost. The cap shown is the server's, not the caller's. */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a target company or place." }, { status: 400 });
  const entities = entitiesFromForm(parsed.data.target, parsed.data.competitors);
  if (entities.length === 0) return NextResponse.json({ error: "No target found in that text." }, { status: 400 });
  const cap = serverCapMicros();
  const priced = IS_DEMO ? { prices: FALLBACK_PRICES, source: "fallback" as const, unread: [] } : await fetchPrices();
  const plan = buildPlan(entities, ["google_maps"], parsed.data.pages, priced.prices, cap);
  return NextResponse.json({ entities, plan, priceNote: priced.source === "catalog" ? "live catalog prices" : `list prices dated ${PRICES_AS_OF}`, unread: priced.unread, demo: IS_DEMO, sources: SOURCE_IDS });
}
