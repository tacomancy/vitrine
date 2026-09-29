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
import { empty, renderApp, scrollsInto, vault } from "./fake-core";
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
