import type { Entity, EntitySummary } from "@/lib/types";

const COLORS = ["var(--emerald)", "var(--amber)", "var(--high)", "var(--mute)", "var(--k3)"];

/** Average rating by month, one line per company. Server-rendered SVG, no chart library. Months with no dated review leave a gap. */
export function TrendChart({ entities, summaries }: { entities: Entity[]; summaries: EntitySummary[] }) {
  const months = [...new Set(summaries.flatMap((s) => s.trend.map((t) => t.month)))].sort();
  if (months.length < 2) return <p className="text-13 text-mute">Not enough dated reviews to draw a trend.</p>;
  const W = 760;
  const H = 240;
  const pad = { l: 34, r: 12, t: 12, b: 28 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (months.length - 1);
  const y = (v: number) => pad.t + ((5 - v) * (H - pad.t - pad.b)) / 4;
  const label = (m: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average rating by month for each company" className="w-full">
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--faint)">{v}</text>
          </g>
        ))}
        {months.map((m, i) => (i % Math.ceil(months.length / 7) === 0 ? <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--faint)">{label(m)}</text> : null))}
        {summaries.map((s, si) => {
          const pts = s.trend.map((t) => ({ i: months.indexOf(t.month), v: t.avgRating }));
          const color = COLORS[si % COLORS.length];
          return (
            <g key={s.entityId}>
              <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} />
              {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3" fill={color} />)}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-12 text-mute">
        {summaries.map((s, si) => (
          <span key={s.entityId} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: COLORS[si % COLORS.length] }} />
            {entities.find((e) => e.id === s.entityId)?.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
