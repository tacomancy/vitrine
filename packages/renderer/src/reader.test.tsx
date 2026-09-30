import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReaderAnnotation, SourcePage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  pressCaptureChord,
  pressGlobalChord,
  renderApp,
  scrollsInto,
  vault,
} from "./fake-core";
import { addressOf } from "./kinds";
import type { PdfDocumentProps } from "./pdf-document";

// The Reader (#424; spec #416 stories 70–79, 87–89). jsdom cannot draw a
// canvas, so the page renderer is a stand-in that lays out three pages of
// the size a letter sheet is and hands each to the overlay, as the real one
// does once a page is near the viewport; everything else is the Reader's
// own, against the fake core.

const opened = vi.hoisted(() => ({ props: null as PdfDocumentProps | null }));
vi.mock("./pdf-document", () => ({
  PdfDocument: (props: PdfDocumentProps) => {
    opened.props = props;
    return (
      <div data-testid="paper">
        {[1, 2, 3].map((number) => (
          <div key={number} data-page={number}>
            {props.overlay({ number, x0: 0, y0: 0, width: 612, height: 792 })}
          </div>
        ))}
      </div>
    );
  },
}));

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  opened.props = null;
  window.vitrine = { port: 1234, token: "t0ken", pathOf: () => "" };
});

const PATH = "sources/rasch2013.md";
const quad = (x: number, y: number, w: number, h: number) => [
  x,
  y + h,
  x + w,
  y + h,
  x,
  y,
  x + w,
  y,
];

const annotation = (
  block: string,
  page: number,
  rest: Partial<ReaderAnnotation> = {}
): ReaderAnnotation => ({
  id: `id-${block}`,
  block,
  kind: "highlight",
  page,
  quads: [quad(72, 600, 200, 12)],
  color: [255, 217, 51],
  note: "",
  quote: `quote of ${block}`,
  question: false,
  ...rest,
});

type Readable = Extract<SourcePage, { readable: true }>;
const source = (rest: Partial<Readable> = {}): Readable => ({
  readable: true,
  path: PATH,
  citekey: "rasch2013",
  title: "Odor cues during slow-wave sleep",
  authors: ["Rasch"],
  year: "2013",
  url: "https://example.org/rasch",
  pdf: "sources/pdf/rasch2013.pdf",
  evicted: false,
  annotations: [
    annotation("h1", 0, { note: "Check this against the control group" }),
    annotation("h2", 1, { color: [92, 176, 255] }),
    annotation("h3", 1, {
      question: true,
      note: "Q: why?",
      color: [255, 128, 187],
    }),
  ],
  position: null,
  ...rest,
});

const answers = (page: unknown, extra: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
  "looseEnds.rows": { groups: [], problems: [] },
  "sources.page": page,
  "sources.connections": [],
  "sources.readingPosition": { written: true },
  "sources.bringDown": { brought: true },
  ...extra,
});

const open = async (
  page: unknown,
  hash = `#/source/${PATH}`,
  extra: Record<string, unknown> = {}
) => {
  window.location.hash = hash;
  const app = renderApp(answers(page, extra));
  await screen.findByRole("region", { name: "Reader" });
  return app;
};

const marks = () => [...document.querySelectorAll<SVGGElement>("[data-block]")];

describe("opening a Source's Address", () => {
  it("draws the page and the overlay: each highlight's block, a Q: highlight's ? glyph", async () => {
    await open(source());
    await screen.findByTestId("paper");
    expect(marks().map((m) => m.dataset["block"])).toEqual(["h1", "h2", "h3"]);
    const question = marks().find((m) => m.dataset["block"] === "h3")!;
    expect(question.querySelector("text")?.textContent).toBe("?");
    expect(question.getAttribute("aria-label")).toBe(
      "Question: quote of h3 — Q: why?"
    );
    expect(marks()[0]!.querySelector("text")).toBeNull();
    // The page is fetched from the core under the token, never a URL with one.
    expect(opened.props).toMatchObject({
      url: "http://127.0.0.1:1234/pdf/sources/pdf/rasch2013.pdf",
      token: "t0ken",
    });
  });

  it("draws a highlight's colour by class, from the PDF's own colour snapped to five", async () => {
    await open(source());
    await screen.findByTestId("paper");
    const classes = marks().map((m) => m.getAttribute("class") ?? "");
    expect(classes[0]).toMatch(/yellow/);
    expect(classes[1]).toMatch(/blue/);
    expect(classes[2]).toMatch(/pink/);
    // Never a colour in an attribute: the palette is the stylesheet's.
    for (const mark of marks()) {
      expect(mark.outerHTML).not.toMatch(
        /fill="|style="|rgb\(|#[0-9a-f]{3,6}/i
      );
    }
  });

  it("puts the paper's title and byline in the header", async () => {
    await open(source());
    expect(
      await screen.findByRole("heading", {
        name: "Odor cues during slow-wave sleep",
      })
    ).toBeDefined();
    expect(screen.getByText("Rasch · 2013")).toBeDefined();
  });

  it("says so when a Source names a PDF the vault does not hold", async () => {
    await open(source({ pdf: null }));
    expect(
      await screen.findByText(/names a PDF that is not in the vault/)
    ).toBeDefined();
    expect(opened.props).toBeNull();
  });
});

describe("arriving", () => {
  it("opens on ?page and scrolling does not rewrite the hash", async () => {
    await open(source(), `#/source/${PATH}?page=3`);
    await screen.findByTestId("paper");
    expect(opened.props!.start).toEqual({ page: 3, offset: 0 });
    act(() => opened.props!.onMove({ page: 2, offset: 0.4 }));
    expect(window.location.hash).toBe(`#/source/${PATH}?page=3`);
  });

  it("opens on the page of ?block, brings it into view and marks it", async () => {
    const asked = scrollsInto();
    await open(source(), `#/source/${PATH}?block=h2`);
    await screen.findByTestId("paper");
    expect(opened.props!.start).toEqual({ page: 2, offset: 0 });
    const arrived = marks().find(
      (m) => m.getAttribute("aria-current") === "location"
    );
    expect(arrived?.dataset["block"]).toBe("h2");
    expect(asked.map((a) => a.row)).toEqual([arrived]);
    expect(window.location.hash).toBe(`#/source/${PATH}?block=h2`);
  });

  it("says so when the block is not in the paper, and still opens it", async () => {
    await open(source(), `#/source/${PATH}?block=h9`);
    expect(
      await screen.findByText(/no highlight h9 to arrive on/)
    ).toBeDefined();
    expect(opened.props!.start).toEqual({ page: 1, offset: 0 });
  });

  it("lands an arrival this app did not write on the Inbox, naming the Address", async () => {
    window.location.hash = `#/source/${PATH}?page=zero`;
    renderApp(answers(source()));
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(
      await within(inbox).findByText(
        /#\/source\/sources\/rasch2013\.md\?page=zero — not an arrival/
      )
    ).toBeDefined();
  });

  it("lands an Address that cannot be resolved on the Inbox, naming itself", async () => {
    window.location.hash = `#/source/sources/stub.md`;
    renderApp(
      answers({
        readable: false,
        path: "sources/stub.md",
        reason: "not a Source: kind is source-stub",
      })
    );
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(
      await within(inbox).findByText(
        "#/source/sources/stub.md — not a Source: kind is source-stub"
      )
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
  });
});

describe("the reading position", () => {
  it("reopens where the reader stopped", async () => {
    await open(source({ position: { page: 3, offset: 0.25 } }));
    await screen.findByTestId("paper");
    expect(opened.props!.start).toEqual({ page: 3, offset: 0.25 });
  });

  it("is an arrival's to override, and is written when the reader moves", async () => {
    const written: unknown[] = [];
    await open(
      source({ position: { page: 3, offset: 0.25 } }),
      `#/source/${PATH}?page=1`,
      {
        "sources.readingPosition": (input: unknown) => {
          written.push(input);
          return { written: true };
        },
      }
    );
    await screen.findByTestId("paper");
    expect(opened.props!.start).toEqual({ page: 1, offset: 0 });
    act(() => opened.props!.onMove({ page: 2, offset: 0.5 }));
    await waitFor(() =>
      expect(written).toEqual([{ path: PATH, page: 2, offset: 0.5 }])
    );
  });
});

describe("an evicted PDF", () => {
  it("is brought down on open, and the page is read again for what that found", async () => {
    let brought = false;
    const reads: boolean[] = [];
    await open(
      (): unknown => {
        reads.push(brought);
        return source({ evicted: !brought });
      },
      `#/source/${PATH}`,
      {
        "sources.bringDown": () => {
          brought = true;
          return { brought: true };
        },
      }
    );
    expect(await screen.findByText(/Bringing the PDF down/)).toBeDefined();
    await screen.findByTestId("paper");
    expect(reads).toEqual([false, true]);
  });
});

describe("an evicted PDF the sync folder has not delivered", () => {
  it("says so instead of saying it is still coming", async () => {
    await open(source({ evicted: true }), `#/source/${PATH}`, {
      "sources.bringDown": { brought: false },
    });
    expect(await screen.findByText(/has not delivered it/)).toBeDefined();
    expect(screen.queryByText(/Bringing the PDF down/)).toBeNull();
  });
});

describe("a Source's own link", () => {
  it.each([
    "https://example.org/rasch",
    "http://example.org/x",
    "mailto:a@example.org",
  ])("goes out for %s", async (url) => {
    await open(source({ url }));
    const link = await screen.findByRole("link", { name: url });
    expect(link.getAttribute("href")).toBe(new URL(url).href);
  });

  it.each([
    ["file:///Users/me/secret.pdf", "file:"],
    ["javascript:alert(1)", "javascript:"],
    ["obsidian://open?vault=v", "obsidian:"],
  ])(
    "draws %s as not a link and says which scheme it had when activated",
    async (url, scheme) => {
      await open(source({ url }));
      const notLink = await screen.findByRole("button", {
        name: `not a link: ${url}`,
      });
      expect(screen.queryByRole("link", { name: url })).toBeNull();
      expect(notLink.getAttribute("href")).toBeNull();
      fireEvent.click(notLink);
      expect(await screen.findByRole("status")).toHaveProperty(
        "textContent",
        `Vitrine will not follow ${scheme} links.`
      );
    }
  );
});

describe("notes and quotes", () => {
  it("are plain text: an address in one is never a link", async () => {
    await open(
      source({
        annotations: [
          annotation("h1", 0, {
            quote: "see https://evil.example/quote",
            note: "and https://evil.example/note or file:///etc/passwd",
          }),
        ],
      })
    );
    const margin = await screen.findByRole("complementary", {
      name: "Annotations",
    });
    expect(
      within(margin).getByText(
        "and https://evil.example/note or file:///etc/passwd"
      )
    ).toBeDefined();
    expect(
      document.querySelectorAll("a[href*='evil'], a[href^='file']")
    ).toHaveLength(0);
    expect(margin.querySelectorAll("a")).toHaveLength(0);
  });
});

function connection(c: {
  path: string;
  kind: string | null;
  name: string;
  block: string | null;
  page: number | null;
  open?: boolean;
}) {
  return { open: false, ...c };
}
const RQ = connection({
  path: "questions/Does odor help (RQ).md",
  kind: "research-question",
  name: "Does odor help?",
  block: "h2",
  page: 2,
});
const NOTE = connection({
  path: "notes/idea.md",
  kind: null,
  name: "idea",
  block: "h1",
  page: 1,
});
const ASKED = connection({
  path: "questions/why.md",
  kind: "question",
  name: "Why the control group?",
  block: "h3",
  page: 2,
  open: true,
});
const WHOLE = connection({
  path: "questions/wonder.md",
  kind: "question",
  name: "Wondering about this paper",
  block: null,
  page: null,
  open: true,
});
const CONNECTIONS = [NOTE, RQ, ASKED, WHOLE];

const ticks = () =>
  [...document.querySelectorAll<HTMLElement>("[data-tick]")].map((t) => ({
    block: t.dataset["tick"],
    label: t.getAttribute("aria-label"),
    glyph: t.textContent,
    el: t,
  }));

describe("the gutter", () => {
  it("draws one labelled tick per annotation something points at, and none for one nothing does", async () => {
    await open(
      source({
        annotations: [
          ...source().annotations,
          annotation("h4", 2, { quote: "nothing points here" }),
        ],
      }),
      `#/source/${PATH}`,
      { "sources.connections": CONNECTIONS }
    );
    await screen.findByTestId("paper");
    await waitFor(() => expect(ticks().length).toBeGreaterThan(0));
    expect(ticks().map((t) => [t.block, t.glyph, t.label])).toEqual([
      ["h1", "·", "a note points at this highlight"],
      ["h2", "■", "a research question points at this highlight"],
      ["h3", "◆", "a question points at this highlight"],
    ]);
  });

  it("sits at the annotation's depth on its page, and reflows nothing", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.connections": [NOTE],
    });
    await waitFor(() => expect(ticks()).toHaveLength(1));
    // The quad's top is 612 on a 792-point page: (792 − 612) / 792.
    const top = parseFloat(ticks()[0]!.el.style.top);
    expect(top).toBeCloseTo(22.7, 1);
    // No badge on the text: the marks carry no count or glyph of a link.
    expect(marks()[0]!.querySelector("text")).toBeNull();
  });

  it("takes amber only for an open Question", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.connections": [
        { ...ASKED, block: "h1", open: false },
        { ...ASKED, path: "questions/again.md", block: "h3", open: true },
        RQ,
      ],
    });
    await waitFor(() => expect(ticks()).toHaveLength(3));
    expect(ticks().map((t) => [t.block, /open/.test(t.el.className)])).toEqual([
      ["h1", false],
      ["h2", false],
      ["h3", true],
    ]);
  });

  it("shows the strongest Kind when several point at one highlight", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.connections": [NOTE, { ...RQ, block: "h1" }],
    });
    await waitFor(() => expect(ticks()).toHaveLength(1));
    expect(ticks()[0]!.glyph).toBe("■");
  });
});

describe("Connections", () => {
  const openPanel = async (connections: unknown[] = CONNECTIONS) => {
    await open(source(), `#/source/${PATH}`, {
      "sources.connections": connections,
    });
    const paper = await screen.findByTestId("paper");
    await screen.findByRole("complementary", { name: "Annotations" });
    fireEvent.keyDown(window, { key: ";", metaKey: true });
    const list = await screen.findByRole("listbox", { name: "Connections" });
    return { paper, list };
  };
  const options = () =>
    within(screen.getByRole("listbox", { name: "Connections" })).getAllByRole(
      "option"
    );

  it("replaces the margin on its chord without reflowing the page, and the chord puts the margin back", async () => {
    const { paper } = await openPanel();
    expect(
      screen.queryByRole("complementary", { name: "Annotations" })
    ).toBeNull();
    // The same paper element, never remounted or resized by the swap.
    expect(screen.getByTestId("paper")).toBe(paper);
    fireEvent.keyDown(window, { key: ";", metaKey: true });
    expect(
      await screen.findByRole("complementary", { name: "Annotations" })
    ).toBeDefined();
    expect(screen.queryByRole("listbox", { name: "Connections" })).toBeNull();
    expect(screen.getByTestId("paper")).toBe(paper);
  });

  it("lists every connection in the order the core gave, each with its Kind and page", async () => {
    await openPanel();
    expect(options().map((o) => o.textContent)).toEqual([
      "·ideap.1",
      "■Does odor help?p.2",
      "◆Why the control group?p.2",
      "◆Wondering about this paperwhole paper",
    ]);
    // A Question with no block is here though no tick marks it.
    expect(ticks().some((t) => t.block === null)).toBe(false);
  });

  it("is a keyboard list that follows its choice and opens where there is an Address", async () => {
    const asked = scrollsInto();
    const { list } = await openPanel();
    expect(document.activeElement).toBe(list);
    const active = () => list.getAttribute("aria-activedescendant");
    expect(active()).toBe(options()[0]!.id);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "j" });
    expect(active()).toBe(options()[2]!.id);
    expect(options()[2]!.getAttribute("aria-selected")).toBe("true");
    expect(asked.map((a) => a.row.id)).toContain(options()[2]!.id);
    fireEvent.keyDown(list, { key: "k" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(window.location.hash).toBe(addressOf(RQ.kind, RQ.path));
  });

  it("opens a connection that has an Address on a click", async () => {
    await openPanel();
    fireEvent.click(options()[3]!);
    expect(window.location.hash).toBe(addressOf(WHOLE.kind, WHOLE.path));
  });

  it("names a connection that has none, and the click says so", async () => {
    await openPanel();
    fireEvent.click(options()[0]!);
    expect(window.location.hash).toBe(`#/source/${PATH}`);
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "idea has no page in Vitrine to open: it is the file notes/idea.md."
    );
  });

  it("says what it is when nothing points at this paper, and never that it is loading", async () => {
    await openPanel([]);
    expect(screen.getByText("Nothing points at this paper yet.")).toBeDefined();
  });

  it("says the read failed rather than that nothing points here", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.connections": () => {
        throw new Error("index is unreadable");
      },
    });
    await screen.findByTestId("paper");
    fireEvent.keyDown(window, { key: ";", metaKey: true });
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "index is unreadable"
    );
    expect(screen.queryByText(/Nothing points/)).toBeNull();
  });
});

// Highlighting a selection (#426; stories 90–91, 94): the Reader offers the
// five colours and a margin note over a selection, and sends an *intent* —
// page, rectangles, colour, note — never quote text or PDF bytes.
describe("highlighting a selection", () => {
  const selection = { page: 2, rects: [[72, 600, 272, 612]] };

  it("offers nothing until text is selected, then sends only the intent", async () => {
    const sent: unknown[] = [];
    await open(source(), `#/source/${PATH}`, {
      "sources.highlight": (input: unknown) => {
        sent.push(input);
        return { id: "nm-1", block: "h4", quote: "what the core read" };
      },
    });
    await screen.findByTestId("paper");
    expect(screen.queryByRole("form", { name: /highlight/i })).toBeNull();

    act(() => opened.props!.onSelect(selection));
    const bar = await screen.findByRole("form", { name: /highlight/i });
    const colours = within(bar)
      .getAllByRole("button", { pressed: false })
      .map((b) => b.getAttribute("aria-label"));
    expect(colours).toEqual(expect.arrayContaining(["blue", "green", "pink"]));

    fireEvent.click(within(bar).getByRole("button", { name: "green" }));
    fireEvent.change(within(bar).getByLabelText("Margin note"), {
      target: { value: "  check the control  " },
    });
    fireEvent.click(within(bar).getByRole("button", { name: "Highlight" }));

    await waitFor(() =>
      expect(sent).toEqual([
        {
          path: PATH,
          page: 2,
          rects: [[72, 600, 272, 612]],
          colour: "green",
          note: "check the control",
        },
      ])
    );
    // Done: the bar is gone and the page is read again for the new block.
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: /highlight/i })).toBeNull()
    );
  });

  it("says the core's own words when the selection is refused, and keeps the selection", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.highlight": () => {
        throw new Error("There is no text under that selection.");
      },
    });
    await screen.findByTestId("paper");
    act(() => opened.props!.onSelect(selection));
    const bar = await screen.findByRole("form", { name: /highlight/i });
    fireEvent.click(within(bar).getByRole("button", { name: "Highlight" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "There is no text under that selection."
    );
    expect(screen.getByRole("form", { name: /highlight/i })).toBeTruthy();
  });

  it("goes away when the selection is let go of, and on Escape", async () => {
    await open(source());
    await screen.findByTestId("paper");
    act(() => opened.props!.onSelect(selection));
    await screen.findByRole("form", { name: /highlight/i });
    act(() => opened.props!.onSelect(null));
    expect(screen.queryByRole("form", { name: /highlight/i })).toBeNull();
    act(() => opened.props!.onSelect(selection));
    fireEvent.keyDown(await screen.findByLabelText("Margin note"), {
      key: "Escape",
    });
    expect(screen.queryByRole("form", { name: /highlight/i })).toBeNull();
  });
});

// Recolour, re-note and remove (#428; stories 104–109): each annotation in
// the margin can be changed by its colour and note, and removed — asking
// first, naming what points at it, when anything does. The renderer sends
// intents and the core decides; extent has no control because resizing is
// remove and redraw.
describe("changing an annotation you made", () => {
  const item = async (block: string) => {
    await screen.findByTestId("paper");
    const list = screen.getByRole("complementary", { name: "Annotations" });
    return within(list)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(`quote of ${block}`))!;
  };

  it("recolours from the five colours, sending only the annotation and the colour", async () => {
    const sent: unknown[] = [];
    await open(source(), `#/source/${PATH}`, {
      "sources.amend": (input: unknown) => {
        sent.push(input);
        return undefined;
      },
    });
    const h2 = await item("h2");
    const group = within(h2).getByRole("group", { name: "Recolour" });
    // The current colour is the one pressed.
    expect(
      within(group).getByRole("button", { name: "blue" }).ariaPressed
    ).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "purple" }));
    await waitFor(() =>
      expect(sent).toEqual([
        { path: PATH, annotation: "id-h2", colour: "purple" },
      ])
    );
  });

  it("edits the note and saves it, cancelling leaves it alone", async () => {
    const sent: unknown[] = [];
    await open(source(), `#/source/${PATH}`, {
      "sources.amend": (input: unknown) => {
        sent.push(input);
        return undefined;
      },
    });
    const h1 = await item("h1");
    fireEvent.click(within(h1).getByRole("button", { name: "Edit note" }));
    const box = within(h1).getByLabelText("Margin note");
    expect((box as HTMLTextAreaElement).value).toBe(
      "Check this against the control group"
    );
    fireEvent.change(box, { target: { value: "  now doubtful  " } });
    fireEvent.click(within(h1).getByRole("button", { name: "Cancel" }));
    expect(sent).toEqual([]);
    fireEvent.click(within(h1).getByRole("button", { name: "Edit note" }));
    fireEvent.change(within(h1).getByLabelText("Margin note"), {
      target: { value: "  now doubtful  " },
    });
    fireEvent.click(within(h1).getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(sent).toEqual([
        { path: PATH, annotation: "id-h1", note: "now doubtful" },
      ])
    );
  });

  it("says the core's words when a change is refused", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.amend": () => {
        throw new Error("The PDF changed while that was being done.");
      },
    });
    const h2 = await item("h2");
    fireEvent.click(within(h2).getByRole("button", { name: "green" }));
    expect((await within(h2).findByRole("status")).textContent).toBe(
      "The PDF changed while that was being done."
    );
  });

  it("offers no control on a note or a shape — only markup can be recoloured or re-noted", async () => {
    await open(
      source({
        annotations: [annotation("h1", 0, { kind: "text", quads: [] })],
      })
    );
    const h1 = await item("h1");
    expect(within(h1).queryByRole("group", { name: "Recolour" })).toBeNull();
    expect(within(h1).queryByRole("button", { name: "Edit note" })).toBeNull();
    // It can still be removed.
    expect(within(h1).getByRole("button", { name: "Remove" })).toBeTruthy();
  });
});

describe("removing an annotation", () => {
  const item = async (block: string) => {
    await screen.findByTestId("paper");
    return within(screen.getByRole("complementary", { name: "Annotations" }))
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(`quote of ${block}`))!;
  };

  it("removes an unlinked annotation at once, without asking", async () => {
    const sent: unknown[] = [];
    await open(source(), `#/source/${PATH}`, {
      "sources.removeAnnotation": (input: unknown) => {
        sent.push(input);
        return { outcome: "removed", block: "h2" };
      },
    });
    fireEvent.click(
      within(await item("h2")).getByRole("button", { name: "Remove" })
    );
    await waitFor(() =>
      expect(sent).toEqual([
        { path: PATH, annotation: "id-h2", confirmed: false },
      ])
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks first when things point at it, naming them, and only removes once confirmed", async () => {
    const sent: unknown[] = [];
    await open(source(), `#/source/${PATH}`, {
      "sources.removeAnnotation": (input: { confirmed: boolean }) => {
        sent.push(input);
        return input.confirmed
          ? { outcome: "gone", block: "h1" }
          : {
              outcome: "confirm",
              links: [
                { path: "notes/plan.md", title: "Plan", kind: null },
                { path: "questions/why.md", title: "Why?", kind: "question" },
              ],
            };
      },
    });
    fireEvent.click(
      within(await item("h1")).getByRole("button", { name: "Remove" })
    );
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText("Plan")).toBeTruthy();
    expect(within(ask).getByText("Why?")).toBeTruthy();
    // Said plainly what removing does to the links.
    expect(ask.textContent).toMatch(/\(gone\)/);
    expect(sent).toHaveLength(1);

    fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sent).toHaveLength(1);

    fireEvent.click(
      within(await item("h1")).getByRole("button", { name: "Remove" })
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove it",
      })
    );
    await waitFor(() =>
      expect(sent.at(-1)).toEqual({
        path: PATH,
        annotation: "id-h1",
        confirmed: true,
      })
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("says the core's words when a removal is refused", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.removeAnnotation": () => {
        throw new Error("The PDF is not on this Mac yet.");
      },
    });
    const h2 = await item("h2");
    fireEvent.click(within(h2).getByRole("button", { name: "Remove" }));
    expect((await within(h2).findByRole("status")).textContent).toBe(
      "The PDF is not on this Mac yet."
    );
  });
});

// A Question from the page (#427; spec #416 stories 97–103): ⌘' with a
// selection sends the selection's intent and the typed words, and the core
// makes the `Q:` highlight and the Question; with none it captures on the
// Source and the page in view and sends no geometry.
describe("⌘' in the Reader", () => {
  const selection = { page: 2, rects: [[72, 600, 272, 612]] };
  const made = (text: string) => ({
    id: "q000000010",
    path: `questions/${text}.md`,
    question: text,
    status: "open",
    captured: "2026-09-30T10:00:00+05:30",
    from: "[[rasch2013]]",
    context: "reading",
  });
  const write = (text: string) => {
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  };

  it("with a selection, sends only the intent and the question, and the provenance needs no typing", async () => {
    const sent: unknown[] = [];
    await open(source(), `#/source/${PATH}`, {
      "sources.question": (input: { text: string }) => {
        sent.push(input);
        return {
          id: "nm-2",
          block: "h4",
          quote: "q",
          // What the core's Question carries when it was made from a highlight.
          question: { ...made(input.text), page: 2, annotation: "h4" },
        };
      },
    });
    await screen.findByTestId("paper");
    act(() => opened.props!.onSelect(selection));

    pressCaptureChord();
    const line = screen.getByRole("form", { name: "Capture" });
    expect(line.textContent).toContain("Reading · rasch2013 · p.2");
    write("Why only slow-wave sleep?");

    await waitFor(() =>
      expect(sent).toEqual([
        {
          path: PATH,
          page: 2,
          rects: [[72, 600, 272, 612]],
          text: "Why only slow-wave sleep?",
        },
      ])
    );
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Capture" })).toBeNull()
    );
    // The highlight is in the PDF now: the selection's bar is spent.
    expect(screen.queryByRole("form", { name: /highlight/i })).toBeNull();
  });

  it("with no selection, captures on the Source and the page in view, and sends no geometry", async () => {
    const capture = vi.fn(({ text }: { text: string }) => made(text));
    const question = vi.fn();
    await open(
      source({ position: { page: 3, offset: 0.1 } }),
      `#/source/${PATH}`,
      {
        "questions.capture": capture,
        "sources.question": question,
      }
    );
    await screen.findByTestId("paper");
    act(() => opened.props!.onMove({ page: 2, offset: 0.4 }));

    pressCaptureChord();
    expect(screen.getByRole("form", { name: "Capture" }).textContent).toContain(
      "Reading · rasch2013 · p.2"
    );
    write("What would falsify this?");

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        text: "What would falsify this?",
        provenance: { context: "reading", source: PATH, page: 2 },
      })
    );
    expect(question).not.toHaveBeenCalled();
  });

  it("starts on the page the paper opened on, before the reader has moved", async () => {
    const capture = vi.fn(({ text }: { text: string }) => made(text));
    await open(
      source({ position: { page: 3, offset: 0 } }),
      `#/source/${PATH}`,
      {
        "questions.capture": capture,
      }
    );
    await screen.findByTestId("paper");
    // The Reader publishes what it has open once it has mounted.
    await act(async () => {});
    pressCaptureChord();
    write("Where does this lead?");
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        text: "Where does this lead?",
        provenance: { context: "reading", source: PATH, page: 3 },
      })
    );
  });

  it("says the core's words when the selection is refused, and keeps the line", async () => {
    await open(source(), `#/source/${PATH}`, {
      "sources.question": () => {
        throw new Error("There is no text under that selection.");
      },
    });
    await screen.findByTestId("paper");
    act(() => opened.props!.onSelect(selection));
    pressCaptureChord();
    write("Is this a scan?");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "There is no text under that selection."
    );
    expect(screen.getByRole("form", { name: "Capture" })).toBeTruthy();
  });

  it("does not carry a selection from one paper to the next", async () => {
    const capture = vi.fn(({ text }: { text: string }) => made(text));
    const question = vi.fn();
    await open(source(), `#/source/${PATH}`, {
      "questions.capture": capture,
      "sources.question": question,
    });
    await screen.findByTestId("paper");
    act(() => opened.props!.onSelect(selection));
    act(() => opened.props!.onSelect(null));
    pressCaptureChord();
    write("After letting go");
    await waitFor(() => expect(capture).toHaveBeenCalled());
    expect(question).not.toHaveBeenCalled();
  });

  it("leaves the global command working from the Reader", async () => {
    await open(source());
    await screen.findByTestId("paper");
    pressGlobalChord();
    expect(
      await screen.findByRole("dialog", { name: "Global command" })
    ).toBeTruthy();
  });
});
