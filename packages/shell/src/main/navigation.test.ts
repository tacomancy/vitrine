import { describe, expect, it } from "vitest";
import { allowNavigation, routeLink } from "./navigation.js";

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

  it("refuses an object URL the app made, which carries the app's origin", () => {
    expect(allowNavigation("blob:http://127.0.0.1:51234/1f2e", APP)).toBe(false);
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

describe("routeLink", () => {
  it("keeps the app's own routes in the window", () => {
    expect(routeLink("http://127.0.0.1:51234/#/settings", APP)).toEqual({
      to: "window",
    });
  });

  it("sends web and mail links to the default browser", () => {
    expect(routeLink("https://arxiv.org/abs/2401.00001", APP)).toEqual({
      to: "browser",
      url: "https://arxiv.org/abs/2401.00001",
    });
    expect(routeLink("http://example.com/paper", APP)).toEqual({
      to: "browser",
      url: "http://example.com/paper",
    });
    expect(routeLink("mailto:someone@example.com", APP)).toEqual({
      to: "browser",
      url: "mailto:someone@example.com",
    });
  });

  it("sends another port on the app's own host out too — it is not the app", () => {
    expect(routeLink("http://127.0.0.1:51235/", APP)).toEqual({
      to: "browser",
      url: "http://127.0.0.1:51235/",
    });
  });

  it("hands the browser the parsed URL, never the text it was given", () => {
    expect(routeLink("HTTPS://Example.com/a b", APP)).toEqual({
      to: "browser",
      url: "https://example.com/a%20b",
    });
  });

  it.each([
    ["file:///Users/someone/paper.pdf", "file:"],
    ["javascript:alert(1)", "javascript:"],
    ["data:text/html,<p>hi</p>", "data:"],
    ["blob:http://127.0.0.1:51234/x", "blob:"],
    ["obsidian://open?vault=v", "obsidian:"],
    ["vitrine://question/x", "vitrine:"],
    ["about:blank", "about:"],
  ])("refuses %s outright, and says which kind of link it was", (url, scheme) => {
    const route = routeLink(url, APP);
    expect(route.to).toBe("refused");
    if (route.to === "refused") expect(route.scheme).toBe(scheme);
  });

  it("refuses what is not a URL at all", () => {
    expect(routeLink("not a url", APP)).toEqual({
      to: "refused",
      scheme: undefined,
    });
  });
});
