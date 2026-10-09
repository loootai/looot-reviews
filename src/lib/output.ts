import { usd, usdPrecise } from "./money";
import type { Plan } from "./runner";
import type { Entity, Report } from "./types";

function cell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per review. */
export function reviewsToCsv(report: Report): string {
  const names = new Map(report.entities.map((e) => [e.id, e.name]));
  const head = ["entity", "source", "rating", "date", "title", "text"];
  const rows = report.reviews.map((r) => [names.get(r.entityId) ?? r.entityId, r.source, r.rating, r.date, r.title, r.text].map(cell).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}

/** The plan as text: each step, its list price, the most it can cost and the cap. */
export function renderPlan(plan: Plan, entities: Entity[], priceNote: string): string {
  const names = new Map(entities.map((e) => [e.id, e.name]));
  const out = ["Plan", ""];
  for (const l of plan.lines) out.push(`  ${(names.get(l.entityId) ?? l.entityId).padEnd(26)} ${l.source.padEnd(12)} ${l.step.padEnd(14)} ${l.endpointId.padEnd(38)} ${String(l.maxCalls).padStart(2)} x ${usdPrecise(l.priceMicros)}`);
  for (const s of plan.skipped) out.push(`  ${(names.get(s.entityId) ?? s.entityId).padEnd(26)} skipped: ${s.reason}`);
  out.push("", `  Up to ${usdPrecise(plan.maxMicros)} (${usdPrecise(plan.minMicros)} if each source ends after one page) at ${priceNote}. ${plan.pages} page(s) per source. Spend cap ${usdPrecise(plan.capMicros)}.`);
  if (!plan.withinCap) out.push("  The most the plan can cost is over the cap. Calls run in order until the cap stops them.");
  return out.join("\n");
}

/** Markdown brief: ratings, themes with quotes, weak spots and what each source returned. */
export function reportToMarkdown(report: Report): string {
  const names = new Map(report.entities.map((e) => [e.id, e.name]));
  const L: string[] = ["# Review intelligence", "", `Pulled ${report.createdAt.slice(0, 10)}. ${report.reviews.length} reviews for ${report.entities.length} companies. Spent ${usd(report.spendMicros)} of a ${usd(report.capMicros)} cap. Themes by ${report.themeMethod === "keywords" ? "keywords and repeated phrases, no LLM" : "keywords and repeated phrases, merged by an LLM step"}.`, ""];
  for (const n of report.notes) L.push(`Note: ${n}`, "");
  L.push("## Ratings", "", "| Company | Reviews | Average | Last 90 days vs the 90 before |", "| --- | --- | --- | --- |");
  for (const s of report.summaries) L.push(`| ${names.get(s.entityId)} | ${s.reviewCount} | ${s.avgRating ?? "none"} | ${s.change90d === null ? "not enough dated reviews" : `${s.change90d > 0 ? "+" : ""}${s.change90d}`} |`);
  L.push("", "## Where competitors are weak", "");
  if (report.weakSpots.length === 0) L.push("None found. A weak spot needs 3 or more competitor mentions and a rating of 3 or lower on the theme.", "");
  for (const w of report.weakSpots) L.push(`- **${names.get(w.competitorId)}, ${w.themeLabel}.** ${w.reason}${w.quote ? ` "${w.quote.text}" (from a ${w.quote.rating} star review)` : ""}`);
  L.push("", "## Themes", "");
  for (const t of report.themes) {
    L.push(`### ${t.label}`, "", `${t.total} reviews (${Math.round(t.share * 100)}%), average ${t.avgRating}. ${t.origin === "found" ? "Found by repeated phrases." : t.origin === "llm" ? "Merged by the LLM step." : "Named theme from config/themes.json."}`, "");
    L.push(...Object.entries(t.byEntity).map(([id, s]) => `- ${names.get(id)}: ${s.count} mentions, average ${s.avgRating}, ${s.negative} negative`), "");
    L.push(...t.quotes.map((q) => `> "${q.text}" from a ${q.rating} star review, ${names.get(q.entityId)}, ${q.source}`), "");
  }
  L.push("## Sources", "", "| Company | Source | Step | Endpoint | State | Reviews | Cost |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of report.runs) L.push(`| ${names.get(r.entityId) ?? r.entityId} | ${r.source} | ${r.step} | ${r.endpointId || "none"} | ${r.state}${r.message ? `, ${r.message.replace(/\|/g, "/")}` : ""} | ${r.reviewCount} | ${usdPrecise(r.costMicros)} |`);
  return L.join("\n") + "\n";
}
