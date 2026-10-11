import { parseCapUsd } from "./spend";

/** Default cap for one pull from the web form, in dollars. */
export const DEFAULT_SERVER_CAP_USD = "0.50";

/**
 * The spend cap for a pull started from the web UI, in micro-dollars. It comes from the server's own
 * environment (REVIEWS_SPEND_CAP_USD), never from the request. A bad value falls back to the default.
 */
export function serverCapMicros(env: Record<string, string | undefined> = process.env): number {
  try {
    return parseCapUsd(env.REVIEWS_SPEND_CAP_USD?.trim() || DEFAULT_SERVER_CAP_USD);
  } catch {
    return parseCapUsd(DEFAULT_SERVER_CAP_USD);
  }
}
