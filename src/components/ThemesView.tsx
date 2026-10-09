"use client";

import { useMemo, useState } from "react";
import type { Report } from "@/lib/types";

/** Themes with a count per company, the average rating, and example quotes. Filter by company and by mood. */
export function ThemesView({ report }: { report: Report }) {
  const [entity, setEntity] = useState("all");
  const [mood, setMood] = useState<"all" | "pain" | "praise">("all");
  const names = useMemo(() => new Map(report.entities.map((e) => [e.id, e.name])), [report.entities]);
  const rows = useMemo(
    () =>
      report.themes
        .map((t) => {
          const count = entity === "all" ? t.total : (t.byEntity[entity]?.count ?? 0);
          const avg = entity === "all" ? t.avgRating : (t.byEntity[entity]?.avgRating ?? 0);
          return { t, count, avg };
        })
        .filter((r) => r.count > 0 && (mood === "all" || (mood === "pain" ? r.avg < 3 : r.avg >= 4)))
        .sort((a, b) => b.count - a.count),
    [report.themes, entity, mood],
  );
  const max = Math.max(1, ...report.themes.flatMap((t) => Object.values(t.byEntity).map((s) => s.count)));
  const pill = (on: boolean) => `rounded-control border px-2.5 py-1 text-12 ${on ? "border-brand bg-brand text-brand-ink" : "border-line bg-panel text-mute hover:text-ink"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={pill(entity === "all")} onClick={() => setEntity("all")}>Everyone</button>
        {report.entities.map((e) => (
          <button key={e.id} type="button" className={pill(entity === e.id)} onClick={() => setEntity(e.id)}>{e.name}</button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <button type="button" className={pill(mood === "all")} onClick={() => setMood("all")}>Any mood</button>
        <button type="button" className={pill(mood === "pain")} onClick={() => setMood("pain")}>Pain, under 3</button>
        <button type="button" className={pill(mood === "praise")} onClick={() => setMood("praise")}>Praise, 4 and up</button>
      </div>
      {rows.length === 0 && <p className="rounded-panel border border-dashed border-line-strong p-8 text-center text-13 text-mute">No theme matches these filters.</p>}
      <ul className="space-y-3">
        {rows.map(({ t, count, avg }) => (
          <li key={t.id} className="rounded-panel border border-line bg-panel p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-14 font-semibold">{t.label}</h2>
              <span className="num text-12 text-mute">{count} reviews, average {avg.toFixed(2)}</span>
              <span className="rounded-control bg-hover px-1.5 py-0.5 text-11 text-faint">{t.origin === "found" ? "found by repeated phrases" : t.origin === "llm" ? "merged by LLM" : "named theme"}</span>
            </div>
            <div className="mt-3 grid gap-x-8 gap-y-1.5 md:grid-cols-3">
              {report.entities.map((e) => {
                const s = t.byEntity[e.id];
                return (
                  <div key={e.id} className="text-12">
                    <div className="flex justify-between"><span className="truncate text-mute">{e.name}</span><span className="num">{s ? `${s.count} at ${s.avgRating.toFixed(1)}` : "0"}</span></div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-hover"><div className="h-full rounded-full" style={{ width: `${s ? (s.count / max) * 100 : 0}%`, background: s && s.avgRating < 3 ? "var(--high)" : "var(--emerald)" }} /></div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 space-y-1.5">
              {t.quotes.map((q, i) => (
                <blockquote key={i} className="border-l-2 border-line-strong pl-3 text-13 italic text-mute">
                  &ldquo;{q.text}&rdquo; <span className="not-italic text-faint">from a {q.rating} star review, {names.get(q.entityId)}, {q.source.replace("_", " ")}</span>
                </blockquote>
              ))}
            </div>
            <p className="mt-2 text-11 text-faint">Keywords: {t.keywords.slice(0, 8).join(", ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
