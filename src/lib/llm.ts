import type { Refiner } from "./analyze";

/**
 * The optional LLM step. It runs only when REVIEWS_LLM_API_KEY and REVIEWS_LLM_MODEL are both set.
 * It sends theme labels, keywords and up to two short quotes per theme to the Anthropic Messages API
 * (or to REVIEWS_LLM_BASE_URL) and asks which themes to merge and what to call them.
 * It never sees the full review set, and the counts are always recomputed locally from the keywords.
 * This call is billed by your model provider, not by looot.
 */
export function refinerFromEnv(env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Refiner | undefined {
  const key = env.REVIEWS_LLM_API_KEY;
  const model = env.REVIEWS_LLM_MODEL;
  if (!key || !model) return undefined;
  const base = (env.REVIEWS_LLM_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
  return async (themes) => {
    const brief = themes.map((t, i) => ({ index: i, label: t.label, keywords: t.keywords.slice(0, 8), quotes: t.quotes.slice(0, 2).map((q) => q.text) }));
    const prompt = `These are themes found in customer reviews by keyword matching. Merge themes that are about the same thing and give each group a short plain label of at most four words. Reply with JSON only, in this shape: {"groups":[{"label":"...","from":[0,1]}]}. Every theme index may appear in at most one group. Leave out themes you would not merge or rename.\n\n${JSON.stringify(brief)}`;
    const res = await f(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { content?: { type?: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text" || c.text)?.text ?? "";
    return parseGroups(text);
  };
}

/** Pulls {"groups":[...]} out of a model answer that may carry prose or code fences around the JSON. */
export function parseGroups(text: string): { label: string; from: number[] }[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { groups?: { label?: unknown; from?: unknown }[] };
    const groups = (parsed.groups ?? [])
      .filter((g) => typeof g.label === "string" && Array.isArray(g.from))
      .map((g) => ({ label: String(g.label), from: (g.from as unknown[]).filter((n): n is number => typeof n === "number") }));
    return groups.length ? groups : null;
  } catch {
    return null;
  }
}
