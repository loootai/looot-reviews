import Link from "next/link";

/** Shown when no pull has been saved yet. */
export function Empty() {
  return (
    <div className="mx-auto max-w-xl rounded-panel border border-line bg-panel p-8 text-center">
      <h1 className="text-16 font-semibold">No pull yet</h1>
      <p className="mt-2 text-13 text-mute">Name your company or place and a few competitors, see the price, then run. Or start with <code className="num">npm run demo</code> to look around with invented shops.</p>
      <Link href="/new" className="mt-4 inline-block rounded-control bg-brand px-4 py-2 text-13 font-medium text-brand-ink">New pull</Link>
    </div>
  );
}
