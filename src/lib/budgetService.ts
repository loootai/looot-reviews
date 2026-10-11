import { Budget, type BudgetStatus } from "./budget";
import { IS_DEMO } from "./clock";
import { toMicros } from "./money";

/** The period budget file, in the data folder next to the last pull. */
export function getBudget(): Budget {
  return new Budget();
}

/** Used, reserved and remaining for today and this month. Read only. */
export async function budgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  return getBudget().status(now);
}

/** Owner only (the route checks the session and the CSRF token). Saves the daily and monthly budget in dollars. */
export async function setBudget(input: { dailyUsd: unknown; monthlyUsd: unknown }): Promise<BudgetStatus> {
  if (IS_DEMO) throw new Error("Demo mode has no budget to change.");
  const b = getBudget();
  await b.setLimits({ dailyMicros: toMicros(Number(input.dailyUsd)), monthlyMicros: toMicros(Number(input.monthlyUsd)) });
  return b.status();
}
