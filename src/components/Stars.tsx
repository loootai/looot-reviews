/** A rating as text with one filled mark per star. The number is the data; the marks are only a cue. */
export function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="text-faint">none</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="num font-semibold">{value.toFixed(2)}</span>
      <span aria-hidden className="text-12 tracking-tight text-amber">{"★".repeat(Math.round(value))}<span className="text-line-strong">{"★".repeat(5 - Math.round(value))}</span></span>
    </span>
  );
}
