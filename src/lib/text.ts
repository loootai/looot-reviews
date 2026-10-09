/** English stop words. Reviews in other languages still work for named themes; found themes need English or a longer list here. */
export const STOP_WORDS = new Set(
  "a about above after again all also am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further get got had hadn't has hasn't have haven't having he her here hers him his how i i'd i'll i'm i've if in into is isn't it it's its just let's me more most my myself no nor not of off on once only or other our ours out over own same she should shouldn't so some such than that that's the their theirs them then there there's these they they're this those through to too under until up very was wasn't we we're were weren't what what's when where which while who whom why will with won't would wouldn't you you're your yours really definitely absolutely quite pretty always never ever even still one two three first back going went came come told said say says asked make made makes making take took taken want wanted need needed like liked love loved good great nice best better awesome amazing bad worst terrible horrible place app time times day days thing things way lot much many well everyone everything everybody anyone someone behind nothing anything six ten five dollar dollars".split(/\s+/),
);

/** Lowercase word tokens with apostrophes kept inside words. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z][a-z']*/g) ?? [];
}

/** Light plural stripping for display and matching: "dishes" to "dishe" is fine because matching is by prefix. */
export function lightStem(w: string): string {
  const t = w.replace(/'s$/, "");
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith("s") && !/(ss|us|is|ous)$/.test(t)) return t.slice(0, -1);
  return t;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A test for "does this text contain any keyword at the start of a word". */
export function makeMatcher(keywords: string[]): (text: string) => boolean {
  if (keywords.length === 0) return () => false;
  const re = new RegExp(`(?:^|[^a-z])(?:${keywords.map((k) => escapeRegex(k.toLowerCase()).replace(/\\? /g, "\\s+")).join("|")})`, "i");
  return (text) => re.test(text.replace(/[‘’]/g, "'"));
}

/** The sentence of `text` that holds a keyword, cut to a length that reads as a quote. Falls back to the start of the text. */
export function quoteAround(text: string, test: (t: string) => boolean, max = 200): string {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => test(s)) ?? sentences[0] ?? text;
  return hit.length > max ? `${hit.slice(0, max - 3).trimEnd()}...` : hit;
}
