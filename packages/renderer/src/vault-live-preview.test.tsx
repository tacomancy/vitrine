import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Inline-only live preview (#700; spec #680, stories 16–18, 21): the marks
// that make prose are hidden off the cursor's line and shown on it, and the
// shapes the first slice does not render stay as the text they are. An embed
// that resolves to an image is drawn as one (#752; spec #751 stories 5–6, 8).

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const FILE = (text: string) => ({
  text,
  hash: "h",
  eol: "lf",
  bom: false,
  mtime: Date.UTC(2026, 7, 5, 12),
});

const open = async (text: string, links: Record<string, unknown> = {}) => {
  window.location.hash = "#/vault/plain.md";
  renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.tree": [{ path: "plain.md", kind: null }],
    "vault.pdfFault": null,
    "vault.read": () => FILE(text),
    "vault.resolveLinks": links,
  });
  const box = await screen.findByRole("textbox", { name: "Editor" });
  const view = EditorView.findFromDOM(
    box.closest(".cm-editor") as HTMLElement
  )!;
  return { box, view };
};

/** What each line shows, hidden marks gone. */
const lines = (box: HTMLElement) =>
  Array.from(box.querySelectorAll(".cm-line")).map((l) => l.textContent);

const cursorAt = (view: EditorView, pos: number) =>
  view.dispatch({ selection: EditorSelection.cursor(pos) });

describe("hiding marks off the cursor's line", () => {
  const DOC = [
    "# Title",
    "a **bold** and _soft_ and `code`",
    "see [[Target]] and [[Target|alias]]",
    "tail ^blk",
  ].join("\n");

  it("hides every mark off the cursor's line", async () => {
    const { box, view } = await open(DOC);
    cursorAt(view, DOC.length); // on the last line
    expect(lines(box)).toEqual([
      "Title",
      "a bold and soft and code",
      "see Target and alias",
      "tail ^blk",
    ]);
  });

  it("hides them all on open, the cursor's line included, until the user puts the cursor somewhere (#776)", async () => {
    const { box, view } = await open(DOC);
    expect(lines(box)[0]).toBe("Title");
    expect(lines(box)[1]).toBe("a bold and soft and code");
    cursorAt(view, 2);
    expect(lines(box)[0]).toBe("# Title");
  });

  it("shows the marks on the line the cursor is on, and hides them again when it leaves", async () => {
    const { box, view } = await open(DOC);
    cursorAt(view, DOC.indexOf("bold"));
    expect(lines(box)[1]).toBe("a **bold** and _soft_ and `code`");
    expect(lines(box)[0]).toBe("Title");
    cursorAt(view, 2);
    expect(lines(box)[0]).toBe("# Title");
    expect(lines(box)[1]).toBe("a bold and soft and code");
  });

  it("shows the wikilink's brackets and alias pipe on its line", async () => {
    const { box, view } = await open(DOC);
    cursorAt(view, DOC.indexOf("Target"));
    expect(lines(box)[2]).toBe("see [[Target]] and [[Target|alias]]");
  });

  it("keeps an escaped pipe in the target and hides only up to the alias pipe", async () => {
    const { box, view } = await open("[[a\\|b|alias]]\nx");
    cursorAt(view, 16);
    expect(lines(box)[0]).toBe("alias");
  });

  it("hides a block id off its line", async () => {
    const { box, view } = await open("para ^blk\n\nnext");
    cursorAt(view, 14);
    expect(lines(box)[0]).toBe("para");
  });

  it("treats every line of a multi-line selection as the cursor's", async () => {
    const { box, view } = await open("**a**\n**b**\n**c**");
    view.dispatch({ selection: EditorSelection.range(0, 8) });
    expect(lines(box)).toEqual(["**a**", "**b**", "c"]);
  });
});

describe("what stays as text", () => {
  it("leaves frontmatter, a table, an embed that is not an image and a callout exactly as written", async () => {
    const doc = [
      "---",
      "title: **x** `y` [[T]] _z_",
      "---",
      "",
      "| a | b |",
      "| - | - |",
      "| **x** | [[T]] |",
      "",
      "![[Embedded]]",
      "",
      "> [!note] Title",
      "> **x** and [[T]]",
      "",
      "```",
      "`x` **y**",
      "```",
      "",
      "end",
    ].join("\n");
    const { box, view } = await open(doc);
    cursorAt(view, doc.length);
    expect(lines(box)).toEqual(doc.split("\n"));
  });
});

describe("a hidden mark cannot be half-deleted", () => {
  it("moves the cursor over a hidden `[[` as one step", async () => {
    const doc = "x\n[[T]] y";
    const { view } = await open(doc);
    cursorAt(view, 0);
    // Off the wikilink's line the brackets are hidden: the position between
    // the two `[` is not one the cursor can stop at.
    const moved = view.moveByChar(EditorSelection.cursor(2), true);
    expect(moved.head).not.toBe(3);
    const atoms = view.state.facet(EditorView.atomicRanges);
    const ranges = atoms
      .map((f) => f(view))
      .flatMap((set) => {
        const out: [number, number][] = [];
        for (const c = set.iter(); c.value; c.next()) out.push([c.from, c.to]);
        return out;
      });
    expect(ranges).toContainEqual([2, 4]);
  });
});

describe("a 1 MB note", () => {
  it("opens and moves its cursor without decorating the whole note", async () => {
    const para =
      "A **bold** claim with [[Link|alias]] and `code`, then more.\n";
    const doc = para.repeat(Math.ceil(1_000_000 / para.length));
    const started = performance.now();
    const { box, view } = await open(doc);
    cursorAt(view, doc.length - 5);
    cursorAt(view, 10);
    const elapsed = performance.now() - started;
    expect(doc.length).toBeGreaterThanOrEqual(1_000_000);
    expect(elapsed).toBeLessThan(5000);
    // Only the viewport is drawn, so only it is parsed for marks.
    expect(box.querySelectorAll(".cm-line").length).toBeLessThan(2000);
    expect(lines(box)[0]).toBe(para.trimEnd()); // the cursor's line, shown
    expect(lines(box)[1]).toBe("A bold claim with alias and code, then more.");
  });
});

describe("an image embed", () => {
  const DOC = ["intro", "", "![[diagram.png]]", "", "tail"].join("\n");
  const RESOLVED = {
    "diagram.png": {
      resolution: "resolved",
      path: "assets/diagram.png",
      kind: null,
      candidates: [],
    },
  };
  let fetched: { url: string; init: RequestInit | undefined }[];
  let revoked: Mock<(url: string) => void>;

  beforeEach(() => {
    fetched = [];
    window.vitrine = { port: 4242, token: "session-token", pathOf: () => "" };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        fetched.push({ url, init });
        return Promise.resolve(
          new Response(new Blob([new Uint8Array([137, 80, 78, 71])]))
        );
      })
    );
    URL.createObjectURL = vi.fn(() => "blob:vitrine/1");
    revoked = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revoked;
  });
  afterEach(() => vi.unstubAllGlobals());

  const images = (box: HTMLElement) =>
    Array.from(box.querySelectorAll<HTMLImageElement>("img"));

  it("draws the picture off the cursor's line, from its bytes fetched with the bearer header", async () => {
    const { box, view } = await open(DOC, RESOLVED);
    cursorAt(view, 2);
    await waitFor(() =>
      expect(images(box).map((i) => i.getAttribute("src"))).toEqual([
        "blob:vitrine/1",
      ])
    );
    expect(lines(box)).not.toContain("![[diagram.png]]");
    expect(fetched.map((f) => f.url)).toEqual([
      "http://127.0.0.1:4242/vault-image/assets/diagram.png",
    ]);
    expect(new Headers(fetched[0]!.init?.headers).get("authorization")).toBe(
      "Bearer session-token"
    );
  });

  it("shows the embed's text on the cursor's line, and the picture again when the cursor leaves", async () => {
    const { box, view } = await open(DOC, RESOLVED);
    cursorAt(view, 2);
    await waitFor(() => expect(images(box)).toHaveLength(1));
    cursorAt(view, DOC.indexOf("![["));
    await waitFor(() => expect(images(box)).toHaveLength(0));
    expect(lines(box)).toContain("![[diagram.png]]");
    cursorAt(view, 2);
    await waitFor(() => expect(images(box)).toHaveLength(1));
    expect(lines(box)).not.toContain("![[diagram.png]]");
  });

  it("keeps the object URL across cursor moves and revokes it once, when the picture goes", async () => {
    const { box, view } = await open(DOC, RESOLVED);
    cursorAt(view, 2);
    await waitFor(() => expect(images(box)).toHaveLength(1));
    cursorAt(view, 0);
    cursorAt(view, DOC.length);
    expect(images(box)).toHaveLength(1);
    expect(revoked).not.toHaveBeenCalled();
    cursorAt(view, DOC.indexOf("![["));
    await waitFor(() => expect(images(box)).toHaveLength(0));
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledWith("blob:vitrine/1");
  });

  it("leaves an embed as written until the index has answered for it", async () => {
    const { box, view } = await open(DOC, {});
    cursorAt(view, 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(images(box)).toHaveLength(0);
    expect(lines(box)).toContain("![[diagram.png]]");
    expect(fetched).toEqual([]);
  });

  const sized = async (embed: string) => {
    const { box, view } = await open(
      `intro\n\n${embed}\n\ntail`,
      Object.fromEntries(
        [embed.slice(3, -2)].map((k) => [k, RESOLVED["diagram.png"]])
      )
    );
    cursorAt(view, 2);
    await waitFor(() => expect(images(box)).toHaveLength(1));
    return images(box)[0]!;
  };

  it("sizes the picture by a width, `|300`", async () => {
    const img = await sized("![[diagram.png|300]]");
    expect(img.style.width).toBe("300px");
    // The engine keeps the proportions of a width-only image.
    expect(img.style.height).toBe("");
  });

  it("sizes the picture by `|WxH`", async () => {
    const img = await sized("![[diagram.png|300x150]]");
    expect(img.style.width).toBe("300px");
    expect(img.style.height).toBe("150px");
  });

  it("draws a malformed size at the natural size", async () => {
    for (const embed of [
      "![[diagram.png|big]]",
      "![[diagram.png|300x]]",
      "![[diagram.png|0]]",
      "![[diagram.png|300x0]]",
    ]) {
      cleanup();
      const img = await sized(embed);
      expect(img.style.width).toBe("");
      expect(img.style.height).toBe("");
    }
  });

  it("draws a Markdown image to a vault image, keeping its alt text", async () => {
    const { box, view } = await open(
      "intro\n\n![A diagram](assets/diagram.png)\n\ntail",
      { "assets/diagram.png": RESOLVED["diagram.png"] }
    );
    cursorAt(view, 2);
    await waitFor(() => expect(images(box)).toHaveLength(1));
    expect(images(box)[0]!.alt).toBe("A diagram");
    expect(fetched.map((f) => f.url)).toEqual([
      "http://127.0.0.1:4242/vault-image/assets/diagram.png",
    ]);
    expect(lines(box)).not.toContain("![A diagram](assets/diagram.png)");
  });

  it("decodes a Markdown image's percent-escapes before asking the index", async () => {
    const { box, view } = await open("intro\n\n![](my%20pic.png)\n\ntail", {
      "my pic.png": RESOLVED["diagram.png"],
    });
    cursorAt(view, 2);
    await waitFor(() => expect(images(box)).toHaveLength(1));
  });

  it("reads an angle-bracketed Markdown destination without its brackets", async () => {
    const { box, view } = await open("intro\n\n![](<my pic.png>)\n", {
      "my pic.png": RESOLVED["diagram.png"],
    });
    cursorAt(view, 2);
    await waitFor(() => expect(images(box)).toHaveLength(1));
  });

  it("leaves a Markdown image to the web as written", async () => {
    const { box, view } = await open(
      "intro\n\n![x](https://example.com/a.png)\n",
      {}
    );
    cursorAt(view, 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(images(box)).toHaveLength(0);
    expect(fetched).toEqual([]);
  });

  it("names the file an unresolved embed could not find, in place of the embed", async () => {
    const { box, view } = await open(DOC, {
      "diagram.png": {
        resolution: "unresolved",
        path: null,
        kind: null,
        candidates: [],
      },
    });
    cursorAt(view, 2);
    await waitFor(() =>
      expect(box.querySelector(".cm-embed-missing")?.textContent).toBe(
        "Could not find diagram.png"
      )
    );
    expect(images(box)).toHaveLength(0);
    expect(lines(box)).not.toContain("![[diagram.png]]");
    expect(fetched).toEqual([]);
    cursorAt(view, DOC.indexOf("![["));
    await waitFor(() =>
      expect(box.querySelector(".cm-embed-missing")).toBeNull()
    );
    expect(lines(box)).toContain("![[diagram.png]]");
  });

  it("names the file an ambiguous embed could not pick", async () => {
    const { box, view } = await open(DOC, {
      "diagram.png": {
        resolution: "ambiguous",
        path: null,
        kind: null,
        candidates: [
          { path: "a/diagram.png", kind: null },
          { path: "b/diagram.png", kind: null },
        ],
      },
    });
    cursorAt(view, 2);
    await waitFor(() =>
      expect(box.querySelector(".cm-embed-missing")?.textContent).toBe(
        "Could not choose between the files named diagram.png"
      )
    );
  });

  it("names the file a Markdown image could not find", async () => {
    const { box, view } = await open("intro\n\n![alt](gone.png)\n", {
      "gone.png": {
        resolution: "unresolved",
        path: null,
        kind: null,
        candidates: [],
      },
    });
    cursorAt(view, 2);
    await waitFor(() =>
      expect(box.querySelector(".cm-embed-missing")?.textContent).toBe(
        "Could not find gone.png"
      )
    );
  });

  it("leaves an embed of a file that is not an image as written", async () => {
    const { box, view } = await open("x\n\n![[notes.md]]\n", {
      "notes.md": {
        resolution: "resolved",
        path: "notes.md",
        kind: null,
        candidates: [],
      },
    });
    cursorAt(view, 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(images(box)).toHaveLength(0);
    expect(fetched).toEqual([]);
  });
});
