import { describe, expect, it } from "vitest";
import { demoReport } from "@/demo/seed";
import { reportToMarkdown, reviewsToCsv } from "./output";

describe("output", () => {
  it("writes one CSV row per review and quotes awkward cells", async () => {
    const r = await demoReport();
    expect(reviewsToCsv(r).trim().split("\n")).toHaveLength(r.reviews.length + 1);
    expect(reviewsToCsv({ ...r, reviews: [{ ...r.reviews[0], text: 'He said "wow", twice' }] })).toContain('"He said ""wow"", twice"');
  });
  it("writes a brief with ratings, weak spots, themes and sources", async () => {
    const md = reportToMarkdown(await demoReport());
    for (const h of ["## Ratings", "## Where competitors are weak", "## Themes", "## Sources"]) expect(md).toContain(h);
    expect(md).not.toMatch(/—/);
  });
});
