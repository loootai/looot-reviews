import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Env } from "./policy";

/** true when a real looot token or an LLM key is set, or a saved pull exists. Server only. */
export function hasRealData(env: Env = process.env): boolean {
  if (env.LOOOT_TOKEN && env.LOOOT_TOKEN.trim() !== "") return true;
  if (env.REVIEWS_LLM_API_KEY && env.REVIEWS_LLM_API_KEY.trim() !== "") return true;
  return existsSync(join(resolve(/* turbopackIgnore: true */ env.LOOOT_REVIEWS_DATA_DIR || ".looot-data"), "latest.json"));
}
