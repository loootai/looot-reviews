"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminFetch } from "./adminFetch";
import { usdPrecise } from "@/lib/money";
import type { Plan } from "@/lib/runner";
import type { Entity } from "@/lib/types";

interface Quote {
  plan: Plan;
  entities: Entity[];
  priceNote: string;
  unread: string[];
}

/** Target and competitors in, quote out, then a run button that only works on a quote the person has seen. Google Maps only; the CLI adds the other sources. */
export function NewPull({ demo, hasToken, capMicros }: { demo: boolean; hasToken: boolean; capMicros: number }) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [pages, setPages] = useState(2);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const body = (extra: object = {}) => JSON.stringify({ target, competitors, pages, ...extra });
  const reset = () => setQuote(null);

  async function getQuote() {
    setBusy(true);
    setMessage(null);
    const res = await adminFetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: body() });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setQuote(null);
      return setMessage(json.error ?? "Could not quote.");
    }
    setQuote(json);
  }

  async function run() {
    if (!quote) return;
    setBusy(true);
    setMessage("Running. This can take a minute per source.");
    const res = await adminFetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: body({ confirmedMaxMicros: quote.plan.maxMicros }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setMessage(json.error ?? "The run failed.");
    router.push("/");
  }

  const canRun = !demo && hasToken && quote !== null && quote.plan.lines.length > 0 && !busy;
  const field = "w-full rounded-panel border border-line bg-panel p-3 text-13 outline-none focus:border-emerald";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-20 font-semibold">New pull</h1>
        <p className="mt-1 text-13 text-mute">Name your company or place, then the competitors. Add a city after @ so the Google Maps lookup finds the right place. App Store, Google Play and Tripadvisor need ids; use the CLI with a config file for those.</p>
      </div>
      <label className="block text-12 font-medium text-mute">You
        <input value={target} onChange={(e) => { setTarget(e.target.value); reset(); }} placeholder="Blue Door Cafe @ Austin TX" className={`${field} mt-1`} />
      </label>
      <label className="block text-12 font-medium text-mute">Competitors, one per line
        <textarea value={competitors} onChange={(e) => { setCompetitors(e.target.value); reset(); }} rows={4} placeholder={"Copper Pot @ Austin TX\nTin Roof Coffee @ Austin TX"} className={`${field} mt-1`} />
      </label>
      <div className="flex flex-wrap items-center gap-4 text-12 text-mute">
        <label className="flex items-center gap-2">Pages per source
          <select value={pages} onChange={(e) => { setPages(Number(e.target.value)); reset(); }} className="rounded-control border border-line bg-panel px-2 py-1 text-ink">
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} (about {n * 20} reviews)</option>)}
          </select>
        </label>
        <p className="ml-auto">Spend cap <span className="num text-ink">{usdPrecise(capMicros)}</span>, set on the server</p>
      </div>
      <button type="button" onClick={getQuote} disabled={busy || !target.trim()} className="rounded-control border border-line bg-panel px-4 py-2 text-13 font-medium hover:bg-hover disabled:opacity-50">Show the price</button>

      {quote && (
        <section className="rounded-panel border border-line bg-panel">
          <table className="w-full text-left text-13">
            <thead>
              <tr className="border-b border-line text-12 text-faint">
                <th className="p-3 font-medium">Company</th>
                <th className="p-3 font-medium">Step</th>
                <th className="p-3 font-medium">Endpoint</th>
                <th className="p-3 text-right font-medium">Calls at most</th>
                <th className="p-3 text-right font-medium">Each</th>
              </tr>
            </thead>
            <tbody>
              {quote.plan.lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="p-3">{quote.entities.find((e) => e.id === l.entityId)?.name}</td>
                  <td className="p-3">{l.step}</td>
                  <td className="num p-3 text-12 text-mute">{l.endpointId}</td>
                  <td className="num p-3 text-right">{l.maxCalls}</td>
                  <td className="num p-3 text-right">{usdPrecise(l.priceMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 border-t border-line p-3">
            <p className="text-13"><span className="num font-semibold">up to {usdPrecise(quote.plan.maxMicros)}</span> at {quote.priceNote}. Cap <span className="num">{usdPrecise(quote.plan.capMicros)}</span>. Pages after the first happen only if the provider has more.</p>
            <button type="button" onClick={run} disabled={!canRun} className="ml-auto rounded-control bg-brand px-4 py-2 text-13 font-medium text-brand-ink disabled:opacity-40">Run for up to {usdPrecise(quote.plan.maxMicros)}</button>
          </div>
          {!quote.plan.withinCap && <p className="border-t border-line p-3 text-12 text-amber">The most this can cost is over the cap. Calls run in order and stop at the cap.</p>}
          {quote.unread.length > 0 && <p className="border-t border-line p-3 text-12 text-amber">Live price not readable for {quote.unread.join(", ")}. Those calls will not run.</p>}
        </section>
      )}
      {demo && <p className="text-12 text-mute">Demo mode shows the quote but never runs. Set LOOOT_TOKEN and start with <code className="num">npm run dev</code> to run.</p>}
      {!demo && !hasToken && <p className="text-12 text-mute">LOOOT_TOKEN is not set on the server, so the run button stays off.</p>}
      {message && <p role="status" className="text-13 text-mute">{message}</p>}
    </div>
  );
}
