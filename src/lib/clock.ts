/** true when the app runs on seeded data with no looot token. `npm run demo` sets this. */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

/** The demo has a fixed clock, so every number on screen is the same on every machine. */
export const DEMO_TODAY = "2026-10-10";

/** Today as an ISO day. Fixed in demo mode. */
export function today(): string {
  return IS_DEMO ? DEMO_TODAY : new Date().toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 7, 2026" from an ISO day, built by hand so server and browser print the same text. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
