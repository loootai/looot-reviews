import { requireAdminPage } from "@/lib/auth/guard";
import { Empty } from "@/components/Empty";
import { Stars } from "@/components/Stars";
import { TrendChart } from "@/components/TrendChart";
import { usd } from "@/lib/money";
import { loadReport } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireAdminPage();
  const report = await loadReport();
  if (!report) return <Empty />;
  const names = new Map(report.entities.map((e) => [e.id, e.name]));
  const problems = report.runs.filter((r) => r.state === "failed" || r.state === "blocked" || r.state === "pending");
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-20 font-semibold">Review intelligence</h1>
        <p className="text-13 text-mute">
          Pulled <span className="num">{report.createdAt.slice(0, 10)}</span>, <span className="num">{report.reviews.length}</span> reviews, spent <span className="num">{usd(report.spendMicros)}</span> of a <span className="num">{usd(report.capMicros)}</span> cap. Themes by {report.themeMethod === "keywords" ? "keywords and repeated phrases, no LLM" : "keywords and repeated phrases, merged by an LLM step"}.
        </p>
      </div>
      {(problems.length > 0 || report.notes.length > 0) && (
        <div className="space-y-1 rounded-panel border border-line bg-amber-soft p-3 text-13 text-amber">
          {report.notes.map((n) => <p key={n}>{n}</p>)}
          {problems.map((r, i) => <p key={i}>{names.get(r.entityId)}, {r.source} {r.step}: {r.state}. {r.message}</p>)}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        {report.summaries.map((s) => {
          const e = report.entities.find((x) => x.id === s.entityId);
          return (
            <div key={s.entityId} className="rounded-panel border border-line bg-panel p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-14 font-semibold">{e?.name}</h2>
                <span className="text-11 uppercase tracking-wide text-faint">{e?.role === "target" ? "you" : "competitor"}</span>
              </div>
              <div className="mt-2 text-16"><Stars value={s.avgRating} /></div>
              <p className="mt-1 text-12 text-mute">
                <span className="num">{s.reviewCount}</span> reviews.{" "}
                {s.change90d === null ? "Not enough dated reviews for a 90 day change." : <>Last 90 days <span className={`num font-medium ${s.change90d >= 0 ? "text-emerald" : "text-high"}`}>{s.change90d > 0 ? "+" : ""}{s.change90d}</span> against the 90 before.</>}
              </p>
              <div className="mt-3 space-y-1">
                {([5, 4, 3, 2, 1] as const).map((n) => (
                  <div key={n} className="flex items-center gap-2 text-11 text-faint">
                    <span className="num w-2">{n}</span>
                    <span className="h-1.5 flex-1 rounded-full bg-hover"><span className="block h-full rounded-full bg-emerald" style={{ width: `${s.reviewCount ? (s.ratingShare[n] / s.reviewCount) * 100 : 0}%` }} /></span>
                    <span className="num w-6 text-right">{s.ratingShare[n]}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="mb-3 text-16 font-semibold">Rating over time</h2>
        <div className="rounded-panel border border-line bg-panel p-4">
          <TrendChart entities={report.entities} summaries={report.summaries} />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-16 font-semibold">Where competitors are weak</h2>
        <p className="mb-3 text-13 text-mute">A competitor theme with 3 or more mentions and a rating of 3 or lower, where your reviewers are happier or rarely raise it.</p>
        {report.weakSpots.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line-strong p-6 text-center text-13 text-mute">No weak spot found in these reviews.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {report.weakSpots.map((w) => (
              <li key={`${w.competitorId}-${w.themeId}`} className="rounded-panel border border-line bg-panel p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-14 font-semibold">{names.get(w.competitorId)}: {w.themeLabel}</h3>
                  <span className="num text-12 text-high">{w.avgRating.toFixed(2)} on {w.mentions} mentions</span>
                </div>
                <p className="mt-1 text-13 text-mute">{w.reason}</p>
                {w.quote && <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-13 italic text-mute">&ldquo;{w.quote.text}&rdquo; <span className="not-italic text-faint">from a {w.quote.rating} star review</span></blockquote>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
