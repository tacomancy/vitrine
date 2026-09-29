import { describe, expect, it } from "vitest";
import { snapColour } from "./highlight-colour";

describe("snapColour", () => {
  it.each([
    [[255, 217, 51], "yellow"],
    [[250, 240, 20], "yellow"],
    [[0, 122, 255], "blue"],
    [[100, 220, 90], "green"],
    [[255, 105, 180], "pink"],
    [[170, 110, 230], "purple"],
  ])("draws %j as %s", (color, name) => {
    expect(snapColour(color)).toBe(name);
  });

  it("draws a highlight with no colour yellow", () => {
    expect(snapColour(null)).toBe("yellow");
  });
});
