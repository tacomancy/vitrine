import { describe, expect, it } from "vitest";
import { allowNavigation } from "./navigation.js";

const APP = "http://127.0.0.1:51234/";

describe("allowNavigation", () => {
  it("allows a move within the app's own page", () => {
    expect(allowNavigation("http://127.0.0.1:51234/#/experiment/x", APP)).toBe(
      true
    );
    expect(allowNavigation("http://127.0.0.1:51234/", APP)).toBe(true);
  });

  it("refuses a local file, which would open in place of the app", () => {
    expect(allowNavigation("file:///Users/someone/paper.pdf", APP)).toBe(false);
  });

  it("refuses another port on the same host — a different server, not the app", () => {
    expect(allowNavigation("http://127.0.0.1:51235/", APP)).toBe(false);
  });

  it("refuses the wider web", () => {
    expect(allowNavigation("https://example.com/", APP)).toBe(false);
  });

  it("follows the dev server's origin when that is what the window loaded", () => {
    const dev = "http://localhost:5173/";
    expect(allowNavigation("http://localhost:5173/#/settings", dev)).toBe(true);
    expect(allowNavigation("http://127.0.0.1:51234/", dev)).toBe(false);
  });

  it("refuses what is not a URL at all", () => {
    expect(allowNavigation("not a url", APP)).toBe(false);
  });
});
