// Runs before `npm run demo`. The demo has no sign-in, so it refuses to start next to real data
// unless an admin password is set. Same rule as src/lib/auth/policy.ts.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const env = process.env;
const hasAuth = !!(env.REVIEWS_ADMIN_PASSWORD_HASH?.trim() || (env.REVIEWS_ADMIN_PASSWORD && env.REVIEWS_ADMIN_PASSWORD.length >= 12));
const saved = join(resolve(env.LOOOT_REVIEWS_DATA_DIR || ".looot-data"), "latest.json");
const real = [];
if (env.LOOOT_TOKEN?.trim()) real.push("LOOOT_TOKEN is set");
if (env.REVIEWS_LLM_API_KEY?.trim()) real.push("REVIEWS_LLM_API_KEY is set");
if (existsSync(saved)) real.push(`${saved} exists`);
if (real.length > 0 && !hasAuth) {
  console.error(`The demo has no sign-in and will not start next to real data (${real.join(", ")}).`);
  console.error("Run it where none of these exist, or set REVIEWS_ADMIN_PASSWORD (12+ characters) to sign in.");
  process.exit(1);
}
