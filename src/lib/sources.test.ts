import { describe, expect, it } from "vitest";
import { entitiesFromForm, parseEntity } from "./sources";

describe("parseEntity", () => {
  it("splits a name and a location", () => {
    expect(parseEntity("Blue Door Cafe @ Austin TX", "target")).toEqual({ id: "blue-door-cafe-austin-tx", name: "Blue Door Cafe", location: "Austin TX", role: "target" });
    expect(parseEntity("Solo", "competitor")).toMatchObject({ name: "Solo", location: undefined });
    expect(parseEntity("  ", "competitor")).toBeNull();
  });
  it("builds entities from the web form text", () => {
    const es = entitiesFromForm("Me @ X", "A @ X\nB @ X; C");
    expect(es.map((e) => e.role)).toEqual(["target", "competitor", "competitor", "competitor"]);
  });
});
