import { describe, expect, it } from "vitest";
import { formatAge } from "./age";

const now = new Date("2026-09-19T12:00:00Z");

// Age is a neutral fact: the same shape at every age, never a warning.
describe("formatAge", () => {
  it.each([
    ["2026-09-19T11:59:00Z", "today"],
    ["2026-09-18T12:00:01Z", "today"],
    ["2026-09-18T12:00:00Z", "1d"],
    ["2026-09-16T12:00:00Z", "3d"],
    ["2026-08-21T12:00:00Z", "29d"],
    ["2026-08-20T12:00:00Z", "1mo"],
    ["2026-07-19T12:00:00Z", "2mo"],
    ["2025-10-19T12:00:00Z", "11mo"],
    ["2025-09-19T12:00:00Z", "1y"],
    ["2025-01-19T12:00:00Z", "1y 8mo"],
    ["2023-09-19T12:00:00Z", "3y"],
    ["2023-08-01T12:00:00Z", "3y 1mo"],
    ["2026-08-14T09:12:00+01:00", "1mo"],
  ])("%s → %s", (captured, expected) => {
    expect(formatAge(captured, now)).toBe(expected);
  });

  it("is today for a capture a few seconds in the future (clock skew)", () => {
    expect(formatAge("2026-09-19T12:00:30Z", now)).toBe("today");
  });
});
