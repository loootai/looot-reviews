import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { demoReport } from "@/demo/seed";
import { Budget, budgetFile, defaultLimits } from "@/lib/budget";
import { today } from "@/lib/clock";
import { refinerFromEnv } from "@/lib/llm";
import { LoootError, loootFromEnv, type LoootRun, type LoootRunner } from "@/lib/looot";
import { usd, usdPrecise } from "@/lib/money";
import { renderPlan, reportToMarkdown, reviewsToCsv } from "@/lib/output";
import { ENDPOINT_IDS, FALLBACK_PRICES, PRICES_AS_OF, fetchPrices, type PriceResult } from "@/lib/prices";
import { buildPlan, chargeableMicros, runPlan } from "@/lib/runner";
import { parseEntity } from "@/lib/sources";
import { parseCapUsd } from "@/lib/spend";
import { SOURCE_IDS, type Entity, type Report, type SourceId } from "@/lib/types";
import type { Refiner } from "@/lib/analyze";

export const HELP = `Usage: npm run reviews -- --target "Blue Door Cafe @ Austin TX" --competitors "Copper Pot @ Austin TX; Tin Roof @ Austin TX" [options]
       npm run reviews -- --config reviews.example.yaml [options]

  --target <name>       The company or place you care about. "Name @ City" helps the Google Maps lookup.
  --competitors <list>  Other companies or places, separated by semicolons.
  --config <file>       YAML with target and competitors, with optional ids for apps and Tripadvisor.
  --sources <list>      google_maps,app_store,google_play,tripadvisor. Default: every source the entities have an id for.
  --pages <n>           Review pages per source, 1 to 5. Default: 2 (about 40 Google Maps reviews).
  --max-spend <usd>     Hard cap for the run in dollars. Default: 0.50
  --partial             Run until the cap or the period budget is reached, even when the quote is above what is left
  --out <dir>           Where reviews.json, reviews.csv and brief.md go. Default: out
  --dry-run             Print the calls and the list-price total. Make no looot call.
  --fresh <tag>         Pull again even if the same input ran before. Charged again.
  --demo                Write the demo report (invented shops). No token, no call.

Needs LOOOT_TOKEN, except with --dry-run or --demo.
The period budget (daily and monthly) lives in .looot-data/budget.json (LOOOT_REVIEWS_DATA_DIR). LOOOT_REVIEWS_DAILY_USD and
LOOOT_REVIEWS_MONTHLY_USD set the starting amounts (default 10 and 50) until the owner saves new ones in the web UI.
Optional LLM theme step: set REVIEWS_LLM_API_KEY and REVIEWS_LLM_MODEL. Without them, themes come from keywords only.`;

export interface CliDeps {
  log: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  looot?: LoootRunner;
  prices?: () => Promise<PriceResult>;
  readFile?: (path: string) => string;
  refine?: Refiner | null;
}

interface YamlEntity {
  name?: string;
  location?: string;
  placeId?: string;
  cid?: string;
  appStoreId?: string | number;
  playPackage?: string;
  tripadvisorId?: string | number;
}

function fromYaml(raw: string): Entity[] {
  const doc = parseYaml(raw) as { target?: YamlEntity; competitors?: YamlEntity[] } | null;
  const mk = (y: YamlEntity, role: Entity["role"]): Entity | null => {
    if (!y?.name) return null;
    const base = parseEntity([y.name, y.location].filter(Boolean).join(" @ "), role);
    if (!base) return null;
    return { ...base, placeId: y.placeId, cid: y.cid, appStoreId: y.appStoreId === undefined ? undefined : String(y.appStoreId), playPackage: y.playPackage, tripadvisorId: y.tripadvisorId === undefined ? undefined : String(y.tripadvisorId) };
  };
  return [doc?.target ? mk(doc.target, "target") : null, ...(doc?.competitors ?? []).map((c) => mk(c, "competitor"))].filter((e): e is Entity => e !== null);
}

/** Runs the CLI. Returns the exit code: 0 done, 1 some sources failed or are pending, 2 bad usage. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        target: { type: "string" },
        competitors: { type: "string" },
        config: { type: "string" },
        sources: { type: "string" },
        pages: { type: "string", default: "2" },
        "max-spend": { type: "string", default: "0.50" },
        out: { type: "string", default: "out" },
        "dry-run": { type: "boolean", default: false },
        partial: { type: "boolean", default: false },
        fresh: { type: "string" },
        demo: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    deps.log(HELP);
    return 0;
  }
  const out = args.out as string;
  const refine = deps.refine === undefined ? refinerFromEnv(deps.env) : (deps.refine ?? undefined);

  if (args.demo) {
    const report = await demoReport();
    writeOutputs(out, report, deps);
    deps.log(`Demo report written to ${out}. ${report.reviews.length} invented reviews, no looot call.`);
    return 0;
  }

  let entities: Entity[];
  const read = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  if (args.config) {
    try {
      entities = fromYaml(read(args.config));
    } catch (e) {
      deps.err(`Could not read ${args.config}: ${(e as Error).message}`);
      return 2;
    }
  } else {
    const target = args.target ? parseEntity(args.target, "target") : null;
    const rivals = (args.competitors ?? "").split(";").map((s) => parseEntity(s, "competitor")).filter((e): e is Entity => e !== null);
    entities = [...(target ? [target] : []), ...rivals];
  }
  if (!entities.some((e) => e.role === "target")) {
    deps.err(`Give a target with --target or in the config file.\n\n${HELP}`);
    return 2;
  }

  const sources = (args.sources ? args.sources.split(",").map((s) => s.trim()) : SOURCE_IDS) as SourceId[];
  const bad = sources.filter((s) => !SOURCE_IDS.includes(s));
  if (bad.length > 0) {
    deps.err(`Unknown source: ${bad.join(", ")}. Use ${SOURCE_IDS.join(", ")}. Trustpilot and G2 are not available through looot.`);
    return 2;
  }
  const pages = Number(args.pages);
  if (!Number.isInteger(pages) || pages < 1 || pages > 5) {
    deps.err("--pages must be a whole number from 1 to 5.");
    return 2;
  }
  let cap: number;
  try {
    cap = parseCapUsd(args["max-spend"] as string);
  } catch (e) {
    deps.err((e as Error).message);
    return 2;
  }

  if (args["dry-run"]) {
    deps.log(renderPlan(buildPlan(entities, sources, pages, FALLBACK_PRICES, cap), entities, `list prices dated ${PRICES_AS_OF}`));
    deps.log("\nDry run: no looot call was made and nothing was written.");
    return 0;
  }

  let looot = deps.looot;
  if (!looot) {
    try {
      looot = loootFromEnv(deps.env);
    } catch (e) {
      if (e instanceof LoootError) {
        deps.err("LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run or --demo.");
        return 2;
      }
      throw e;
    }
  }
  const priced = await (deps.prices ?? (() => fetchPrices(ENDPOINT_IDS)))();
  const plan = buildPlan(entities, sources, pages, priced.prices, cap);
  deps.log(renderPlan(plan, entities, priced.source === "catalog" ? "live catalog prices" : `list prices dated ${PRICES_AS_OF}`));
  if (priced.unread.length > 0) deps.log(`\nThe live price of ${priced.unread.join(", ")} could not be read. Those calls will not run.`);
  deps.log(`\nRunning, at most ${usdPrecise(Math.min(plan.maxMicros, cap))}.\n`);

  // Check order: quote, per-run cap, period budget, then the calls. Runs that ended since last time settle first.
  const budget = new Budget(budgetFile(deps.env), defaultLimits(deps.env));
  if ("getRun" in looot) await budget.reconcile(looot as unknown as { getRun(id: string): Promise<LoootRun> }).catch(() => undefined);
  const room = await budget.status();
  deps.log(`Budget left: ${usd(room.remainingMicros)} (${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month, ${usd(room.day.reservedMicros)} reserved).`);
  if ((await chargeableMicros(plan, budget, { freshTag: args.fresh })) > room.remainingMicros && !args.partial) {
    deps.err("Refused: the quote is above what is left of the period budget. Wait for the period to roll over, raise the budget on the Costs page of the web UI, or pass --partial to run until it is reached.");
    return 2;
  }

  const report = await runPlan({
    entities,
    sources,
    plan,
    looot,
    ledger: budget,
    prices: priced.prices,
    unpriced: priced.unread,
    today: today(),
    freshTag: args.fresh,
    refine,
    onProgress: (r) => deps.log(`  ${r.entityId} ${r.source} ${r.step}: ${r.state}, ${r.reviewCount} reviews, ${usdPrecise(r.costMicros)}${r.message ? `. ${r.message}` : ""}`),
  });
  writeOutputs(out, report, deps);
  const pending = report.runs.filter((r) => r.state === "pending").length;
  const failed = report.runs.filter((r) => r.state === "failed" || r.state === "blocked").length;
  deps.log(`\n${report.reviews.length} reviews, ${report.themes.length} themes. Spent ${usdPrecise(report.spendMicros)} of ${usdPrecise(report.capMicros)}. Written to ${out}.`);
  if (pending > 0) deps.log(`${pending} call(s) are pending, not failed. Run the same command again to read them.`);
  return failed > 0 || pending > 0 ? 1 : 0;
}

function writeOutputs(dir: string, report: Report, deps: CliDeps): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "reviews.json"), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(dir, "reviews.csv"), reviewsToCsv(report));
  writeFileSync(join(dir, "brief.md"), reportToMarkdown(report));
  deps.log(`Wrote ${join(dir, "reviews.json")}, reviews.csv and brief.md.`);
}
