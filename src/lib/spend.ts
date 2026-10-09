import { usdPrecise } from "./money";

/** Price per call in micros for each endpoint id. */
export type PriceMap = Record<string, number>;

/** Tracks spend against a cap for one run. Checked before every looot call. */
export class SpendGuard {
  #spent = 0;
  constructor(readonly capMicros: number) {}

  get spentMicros(): number {
    return this.#spent;
  }

  /** true when a call of this price still fits under the cap, counting what is already spent. */
  canAfford(priceMicros: number): boolean {
    return this.#spent + priceMicros <= this.capMicros;
  }

  /** Adds what a call cost. Uses the quoted price when looot reports no actual cost. */
  record(micros: number): void {
    this.#spent += Math.max(0, micros);
  }

  describe(): string {
    return `${usdPrecise(this.#spent)} of ${usdPrecise(this.capMicros)}`;
  }
}

/** Parses a "--max-spend 0.50" style dollar amount to micros. Throws on junk or on zero. */
export function parseCapUsd(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/^\$/, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Spend cap must be a positive dollar amount, got "${raw}".`);
  return Math.round(n * 1_000_000);
}
