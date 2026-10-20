import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Following a link from the editor (#701; spec #680 stories 15, 41, 42): a
// wikilink or tag is followable by click, a link that goes nowhere is drawn
// differently and says why, and every `href` in note text goes through the
// one link classifier (#407).

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const FILE = (text: string) => ({
  text,
  hash: "h",
  eol: "lf",
  bom: false,
  mtime: Date.UTC(2026, 7, 5, 12),
});
const landing = (
  resolution: string,
  path: string | null,
  kind: string | null,
  candidates: { path: string; kind: string | null }[] = []
) => ({ resolution, path, kind, candidates });

const open = (text: string, links: Record<string, unknown> = {}) => {
  window.location.hash = "#/vault/a.md";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.tree": [{ path: "a.md", kind: null }],
    "vault.pdfFault": null,
    "vault.backlinks": [],
    "vault.read": FILE(text),
    "vault.resolveLinks": links,
  });
};

/** The drawn thing a click lands on: CodeMirror splits text into spans, so find it by what it says. */
const drawn = async (text: string) => {
  await screen.findByRole("textbox", { name: "Editor" });
  const found = await waitFor(() => {
    const el = Array.from(document.querySelectorAll<HTMLElement>(".cm-line *"))
      .filter((e) => e.textContent === text && e.dataset["follow"])
      .at(0);
    expect(el).toBeDefined();
    return el as HTMLElement;
  });
  return found;
};

describe("a wikilink", () => {
  it("follows to a plain Note in the Vault", async () => {
    open("see [[plain]]\n", { plain: landing("resolved", "plain.md", null) });
    fireEvent.click(await drawn("[[plain]]"));
    await waitFor(() => expect(window.location.hash).toBe("#/vault/plain.md"));
  });

  it("follows to a Question on its own surface, not the Vault", async () => {
    open("see [[q]]\n", { q: landing("resolved", "q.md", "question") });
    fireEvent.click(await drawn("[[q]]"));
    await waitFor(() => expect(window.location.hash).toBe("#/question/q.md"));
  });

  it("is drawn differently when it resolves, does not, or is ambiguous", async () => {
    open("[[a]] [[b]] [[c]]\n", {
      a: landing("resolved", "a.md", null),
      b: landing("unresolved", null, null),
      c: landing("ambiguous", null, null, [
        { path: "x/c.md", kind: null },
        { path: "y/c.md", kind: null },
      ]),
    });
    await drawn("[[a]]");
    await waitFor(() =>
      expect(
        ["[[a]]", "[[b]]", "[[c]]"].map((t) =>
          Array.from(document.querySelectorAll<HTMLElement>(".cm-line *"))
            .find((e) => e.textContent === t && e.dataset["follow"])
            ?.getAttribute("data-resolution")
        )
      ).toEqual(["resolved", "unresolved", "ambiguous"])
    );
  });

  it("says an unresolved link is unresolved, in an alert, and goes nowhere", async () => {
    open("[[ghost]]\n", { ghost: landing("unresolved", null, null) });
    fireEvent.click(await drawn("[[ghost]]"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /ghost.*no file/i
    );
    expect(window.location.hash).toBe("#/vault/a.md");
  });

  it("says an ambiguous link is ambiguous and offers its candidates", async () => {
    open("[[dup]]\n", {
      dup: landing("ambiguous", null, null, [
        { path: "x/dup.md", kind: null },
        { path: "y/dup.md", kind: "hypothesis" },
      ]),
    });
    fireEvent.click(await drawn("[[dup]]"));
    expect(await screen.findByText(/ambiguous/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /x\/dup\.md/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /y\/dup\.md/ }));
    expect(window.location.hash).toBe("#/hypothesis/y/dup.md");
  });
});

describe("a tag", () => {
  it("opens the tags tab on its node, listing the files that carry it", async () => {
    window.location.hash = "#/vault/a.md";
    const node = {
      canonical: "ml/probing",
      display: "ml/probing",
      name: "probing",
      implicit: false,
      count: { inclusive: 1, exclusive: 1 },
      files: ["b.md"],
      occurrences: [{ path: "b.md", written: "ML/Probing", source: "inline" }],
      children: [],
    };
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": READ,
      "vault.tree": [
        { path: "a.md", kind: null },
        { path: "b.md", kind: null },
      ],
      "vault.pdfFault": null,
      "vault.backlinks": [],
      "vault.read": FILE("#ML/Probing\n"),
      "vault.resolveLinks": {},
      "vault.tags": { tags: [node], invalid: [] },
    });
    await screen.findByRole("textbox", { name: "Editor" });
    const tag = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-tag]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(tag);
    expect(
      screen.getByRole("tab", { name: "tags" }).getAttribute("aria-selected")
    ).toBe("true");
    await waitFor(() => expect(screen.getByText("ML/Probing")).toBeDefined());
  });
});

describe("a Markdown link in note text", () => {
  const linked = (href: string) => open(`[text](${href})\n`);
  const link = async () => {
    await screen.findByRole("textbox", { name: "Editor" });
    return waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-href]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
  };

  it.each(["https://example.com/p", "mailto:a@b.co"])(
    "goes out for %s",
    async (href) => {
      const out = vi.spyOn(window, "open").mockReturnValue(null);
      linked(href);
      const el = await link();
      expect(el.dataset["notLink"]).toBeUndefined();
      fireEvent.click(el);
      expect(out).toHaveBeenCalledWith(href, "_blank", "noreferrer");
      expect(screen.queryByRole("alert")).toBeNull();
    }
  );

  it("treats a bare URL in the text as a link too", async () => {
    const out = vi.spyOn(window, "open").mockReturnValue(null);
    open("see https://example.com/bare now\n");
    fireEvent.click(await link());
    expect(out).toHaveBeenCalledWith(
      "https://example.com/bare",
      "_blank",
      "noreferrer"
    );
  });

  it.each([
    ["file:///etc/passwd", "file:"],
    ["javascript:alert(1)", "javascript:"],
    ["obsidian://open?vault=x", "obsidian:"],
  ])("draws %s as not a link and says its scheme", async (href, scheme) => {
    const out = vi.spyOn(window, "open").mockReturnValue(null);
    linked(href);
    const el = await link();
    expect(el.dataset["notLink"]).toBe("true");
    fireEvent.click(el);
    expect((await screen.findByRole("alert")).textContent).toContain(scheme);
    expect(out).not.toHaveBeenCalled();
  });
});
