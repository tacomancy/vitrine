import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, scrollsInto, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Vault's *tags* tab (spec #680, #696): the tree `vault.tags` answers,
// inclusive and exclusive counts, a node's files with their Kind and the tag
// as written, and the invalid tags with their reason and file.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const READING = {
  indexing: { done: 1, total: 9 },
  watching: { ok: true },
  current: { ok: true },
};

const TREE = [
  { path: "notes/Idea.md", kind: null },
  { path: "q/What now.md", kind: "question" },
  { path: "sources/Paper.md", kind: "source", annotations: 3 },
];

const node = (
  canonical: string,
  name: string,
  count: { inclusive: number; exclusive: number },
  files: string[],
  occurrences: { path: string; written: string }[],
  children: unknown[] = [],
  implicit = false
) => ({
  canonical,
  display: canonical,
  name,
  implicit,
  count,
  files,
  occurrences: occurrences.map((o) => ({ ...o, source: "inline" })),
  children,
});

// ml (implicit) → ml/probing (2 own) → ml/probing/linear (1); plus ethics.
const TAGS = {
  tags: [
    node(
      "ethics",
      "ethics",
      { inclusive: 1, exclusive: 1 },
      ["q/What now.md"],
      [{ path: "q/What now.md", written: "Ethics" }]
    ),
    node(
      "ml",
      "ml",
      { inclusive: 3, exclusive: 0 },
      ["notes/Idea.md", "sources/Paper.md"],
      [],
      [
        node(
          "ml/probing",
          "probing",
          { inclusive: 3, exclusive: 2 },
          ["notes/Idea.md", "sources/Paper.md"],
          [
            { path: "notes/Idea.md", written: "ml/probing" },
            { path: "sources/Paper.md", written: "ML/Probing" },
          ],
          [
            node(
              "ml/probing/linear",
              "linear",
              { inclusive: 1, exclusive: 1 },
              ["notes/Idea.md"],
              [{ path: "notes/Idea.md", written: "ml/probing/linear" }]
            ),
          ]
        ),
      ],
      true
    ),
  ],
  invalid: [
    {
      path: "notes/Idea.md",
      written: "2024",
      reason: "A tag needs at least one character that is not a digit.",
      source: "frontmatter",
    },
  ],
};

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/vault";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.tree": TREE,
    "vault.pdfFault": null,
    "vault.tags": TAGS,
    ...more,
  });
};

const tagsTab = async () => {
  fireEvent.click(await screen.findByRole("tab", { name: "tags" }));
  return screen.findByRole("tree", { name: "Tags" });
};
const names = () =>
  screen.getAllByRole("treeitem").map((i) => i.getAttribute("aria-label"));
const item = (name: string) => screen.getByRole("treeitem", { name });

describe("the tags tab", () => {
  it("is a tab beside files, files first", async () => {
    open();
    await screen.findByRole("tree", { name: "Files" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "files",
      "tags",
    ]);
    expect(
      screen.getByRole("tab", { name: "files" }).getAttribute("aria-selected")
    ).toBe("true");
    await tagsTab();
    expect(screen.queryByRole("tree", { name: "Files" })).toBeNull();
    expect(
      screen.getByRole("tab", { name: "tags" }).getAttribute("aria-selected")
    ).toBe("true");
  });

  it("parses the hierarchy into a tree with inclusive and exclusive counts as vault.tags answers them", async () => {
    open();
    await tagsTab();
    expect(names()).toEqual([
      "ethics, 1 in all, 1 at this level",
      "ml, 3 in all, 0 at this level",
      "probing, 3 in all, 2 at this level",
      "linear, 1 in all, 1 at this level",
    ]);
    expect(item("probing, 3 in all, 2 at this level").textContent).toContain(
      "3"
    );
    expect(item("probing, 3 in all, 2 at this level").textContent).toContain(
      "2"
    );
    expect(
      item("probing, 3 in all, 2 at this level").getAttribute("aria-level")
    ).toBe("2");
  });

  it("folds a branch from the pointer and the keyboard", async () => {
    open();
    const list = await tagsTab();
    fireEvent.click(item("ml, 3 in all, 0 at this level"));
    // A click chooses the node and, on a branch, leaves it open; the
    // arrows fold it.
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(names()).toEqual([
      "ethics, 1 in all, 1 at this level",
      "ml, 3 in all, 0 at this level",
    ]);
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(names()).toHaveLength(4);
  });

  it("lists a node's files with their Kind and the tag as written, parent including its children", async () => {
    open();
    await tagsTab();
    fireEvent.click(item("ml, 3 in all, 0 at this level"));
    const files = screen.getByRole("list", { name: "Files tagged ml" });
    const rows = within(files).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Idea, tagged #ml/probing, #ml/probing/linear",
      "Paper, source, tagged #ML/Probing",
    ]);
    expect(rows[0]?.getAttribute("href")).toBe("#/vault/notes/Idea.md");
    expect(rows[1]?.textContent).toContain("●");
    expect(rows[1]?.textContent).toContain("#ML/Probing");
  });

  it("narrows to the child's files when the child is chosen", async () => {
    open();
    await tagsTab();
    fireEvent.click(item("linear, 1 in all, 1 at this level"));
    const files = screen.getByRole("list", {
      name: "Files tagged ml/probing/linear",
    });
    expect(within(files).getAllByRole("link")).toHaveLength(1);
  });

  it("keeps the choice on a published id, moves it with the arrows, and keeps it in view (ADR 0030)", async () => {
    const asked = scrollsInto();
    open();
    const list = await tagsTab();
    const chosen = () =>
      document.getElementById(list.getAttribute("aria-activedescendant") ?? "");
    expect(chosen()?.getAttribute("aria-label")).toContain("ethics");
    fireEvent.keyDown(list, { key: "End" });
    expect(chosen()?.getAttribute("aria-label")).toContain("linear");
    expect(asked.at(-1)).toMatchObject({ block: "nearest" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(chosen()?.getAttribute("aria-label")).toContain("probing");
    fireEvent.keyDown(list, { key: "Enter" });
    expect(
      screen.getByRole("list", { name: "Files tagged ml/probing" })
    ).toBeDefined();
  });

  it("reports an invalid tag with its reason and its file, rather than dropping it", async () => {
    open();
    await tagsTab();
    const invalid = screen.getByRole("list", { name: "Invalid tags" });
    expect(invalid.textContent).toContain("2024");
    expect(invalid.textContent).toContain("at least one character");
    const link = within(invalid).getByRole("link");
    expect(link.getAttribute("href")).toBe("#/vault/notes/Idea.md");
    expect(link.textContent).toContain("notes/Idea.md");
    // Information, not a refusal of anything the user did.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no invalid list when every tag is valid", async () => {
    open({ "vault.tags": { ...TAGS, invalid: [] } });
    await tagsTab();
    expect(screen.queryByRole("list", { name: "Invalid tags" })).toBeNull();
  });
});

describe("the voices of an empty tag tree (ADR 0032)", () => {
  const none = { tags: [], invalid: [] };

  it("claims there are no tags once the read is whole", async () => {
    open({ "vault.tags": none });
    fireEvent.click(await screen.findByRole("tab", { name: "tags" }));
    expect(await screen.findByText("No tags yet.")).toBeDefined();
    expect(screen.getByText("read in full · watching")).toBeDefined();
  });

  it("claims nothing while the index is still being read", async () => {
    open({ "vault.tags": none, "vault.status": READING });
    fireEvent.click(await screen.findByRole("tab", { name: "tags" }));
    expect(await screen.findByText("not read yet")).toBeDefined();
    expect(screen.queryByText("No tags yet.")).toBeNull();
  });

  it("says not known, never empty, when the tags could not be read", async () => {
    open({
      "vault.tags": () => {
        throw new Error("boom");
      },
    });
    fireEvent.click(await screen.findByRole("tab", { name: "tags" }));
    expect(await screen.findByText("not known")).toBeDefined();
    expect(screen.queryByText("No tags yet.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
