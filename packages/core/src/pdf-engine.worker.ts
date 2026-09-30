// The PDF engine's worker thread (`pdf-engine.ts` owns the other end). It
// imports nothing from the core: it runs from the built `dist/` and, under
// Node's type stripping, straight from source in tests, and either way the
// only specifier it may name is a package or a `node:` builtin.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import { init } from "@embedpdf/pdfium";
// Type-only, so nothing sibling has to resolve at runtime.
import type {
  AnnotationKind,
  HighlightRequest,
  HighlightResult,
} from "./pdf-engine.ts";

type Job = {
  id: number;
  job: "metadata" | "annotations" | "highlight";
  args?: unknown;
  bytes: Uint8Array;
};

// FPDF_ERR_* from fpdfview.h; the ones a reader can be told apart by.
const FORMAT = 3;
const PASSWORD = 4;
const SECURITY = 5;

const require = createRequire(import.meta.url);
const loading = init({
  wasmBinary: readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")),
}).then((m) => {
  m.PDFiumExt_Init();
  return m;
});

// The typings omit the heap views the runtime exposes.
const heap = (m: Awaited<typeof loading>) =>
  (m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;

/** FPDF_GetMetaText's UTF-16LE answer, NUL-terminated; absent when the field is not there or is blank. */
function metaText(
  m: Awaited<typeof loading>,
  doc: number,
  tag: string
): string | undefined {
  const length = m.FPDF_GetMetaText(doc, tag, 0, 0);
  if (length <= 2) return undefined;
  const ptr = m.pdfium.wasmExports.malloc(length);
  try {
    m.FPDF_GetMetaText(doc, tag, ptr, length);
    const text = Buffer.from(heap(m).subarray(ptr, ptr + length - 2)).toString(
      "utf16le"
    );
    return text.trim() === "" ? undefined : text.trim();
  } finally {
    m.pdfium.wasmExports.free(ptr);
  }
}

type Module = Awaited<typeof loading>;

/** Open the file, run `work` on the document, and always let go of both. */
async function withDocument<T>(
  bytes: Uint8Array,
  work: (m: Module, doc: number) => T
): Promise<T | { unreadable: string }> {
  const m = await loading;
  const ptr = m.pdfium.wasmExports.malloc(bytes.length);
  heap(m).set(bytes, ptr);
  // The buffer has to outlive the document: PDFium reads from it lazily.
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, "");
  if (!doc) {
    const code = m.FPDF_GetLastError();
    m.pdfium.wasmExports.free(ptr);
    return {
      unreadable:
        code === PASSWORD || code === SECURITY
          ? "it is protected by a password"
          : code === FORMAT
            ? "it is damaged, or is not a PDF"
            : "the reader could not open it",
    };
  }
  try {
    return work(m, doc);
  } finally {
    m.FPDF_CloseDocument(doc);
    m.pdfium.wasmExports.free(ptr);
  }
}

const readMetadata = (bytes: Uint8Array) =>
  withDocument(bytes, (m, doc) => ({
    title: metaText(m, doc, "Title"),
    author: metaText(m, doc, "Author"),
  }));

// FPDF_ANNOT_* subtype numbers, mapped onto the kinds Ingest keeps.
const KINDS: Record<number, AnnotationKind> = {
  1: "text",
  3: "freetext",
  4: "shape",
  5: "shape",
  6: "shape",
  7: "shape",
  8: "shape",
  9: "highlight",
  10: "underline",
  11: "squiggly",
  12: "strikeout",
  13: "stamp",
  15: "ink",
};
const MARKUP = new Set(["highlight", "underline", "strikeout", "squiggly"]);

/** Scratch memory in the module's heap, freed together. */
function scratch(m: Module) {
  const ptrs: number[] = [];
  const view = m.pdfium as unknown as {
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;
    HEAPU32: Uint32Array;
  };
  return {
    alloc: (n: number) => {
      const p = m.pdfium.wasmExports.malloc(n);
      ptrs.push(p);
      return p;
    },
    f32: (p: number, n: number) =>
      Array.from(view.HEAPF32.subarray(p / 4, p / 4 + n)),
    f64: (p: number) => view.HEAPF64[p / 8]!,
    u32: (p: number) => view.HEAPU32[p / 4]!,
    free: () => {
      for (const p of ptrs.splice(0)) m.pdfium.wasmExports.free(p);
    },
  };
}

/** An annotation's string key as UTF-16LE, or undefined when the key is not there. */
function annotString(
  m: Module,
  annot: number,
  key: string
): string | undefined {
  const length = m.FPDFAnnot_GetStringValue(annot, key, 0, 0);
  if (length <= 2) return undefined;
  const ptr = m.pdfium.wasmExports.malloc(length);
  try {
    m.FPDFAnnot_GetStringValue(annot, key, ptr, length);
    return Buffer.from(heap(m).subarray(ptr, ptr + length - 2)).toString(
      "utf16le"
    );
  } finally {
    m.pdfium.wasmExports.free(ptr);
  }
}

type Glyph = {
  ch: string;
  generated: boolean;
  hyphen: boolean;
  box: { left: number; right: number; bottom: number; top: number };
  /** Full line height, the box every viewer's own highlighter fills; only read when a highlight is being written. */
  loose: { left: number; right: number; bottom: number; top: number };
};

/**
 * Every character on the page with its box in PDF user space. Generated
 * characters (the spaces and line breaks PDFium inserts) are kept, flagged:
 * they have no real box, but they are what separates words and lines when a
 * quote is joined.
 */
function glyphs(m: Module, page: number, loose = false): Glyph[] {
  const text = m.FPDFText_LoadPage(page);
  const mem = scratch(m);
  try {
    const n = m.FPDFText_CountChars(text);
    const [l, r, b, t] = [
      mem.alloc(8),
      mem.alloc(8),
      mem.alloc(8),
      mem.alloc(8),
    ];
    const wide = loose ? mem.alloc(16) : 0;
    const out: Glyph[] = [];
    for (let i = 0; i < n; i++) {
      m.FPDFText_GetCharBox(text, i, l, r, b, t);
      const box = {
        left: mem.f64(l),
        right: mem.f64(r),
        bottom: mem.f64(b),
        top: mem.f64(t),
      };
      let looseBox = box;
      if (loose) {
        m.FPDFText_GetLooseCharBox(text, i, wide);
        // FS_RECTF is { left, top, right, bottom }.
        const [ll, lt, lr, lb] = mem.f32(wide, 4) as [
          number,
          number,
          number,
          number,
        ];
        looseBox = { left: ll, right: lr, bottom: lb, top: lt };
      }
      out.push({
        ch: String.fromCodePoint(m.FPDFText_GetUnicode(text, i)),
        generated: m.FPDFText_IsGenerated(text, i) === 1,
        // PDFium joins a hyphenated line break itself: the hyphen glyph is
        // kept, flagged, and no line break follows it.
        hyphen: m.FPDFText_IsHyphen(text, i) === 1,
        box,
        loose: looseBox,
      });
    }
    return out;
  } finally {
    mem.free();
    m.FPDFText_ClosePage(text);
  }
}

type Rect = Glyph["box"];

const quadRect = (q: number[]): Rect => ({
  left: Math.min(q[0]!, q[2]!, q[4]!, q[6]!),
  right: Math.max(q[0]!, q[2]!, q[4]!, q[6]!),
  bottom: Math.min(q[1]!, q[3]!, q[5]!, q[7]!),
  top: Math.max(q[1]!, q[3]!, q[5]!, q[7]!),
});

function overlapFraction(box: Rect, rect: Rect): number {
  const w = Math.min(box.right, rect.right) - Math.max(box.left, rect.left);
  const h = Math.min(box.top, rect.top) - Math.max(box.bottom, rect.bottom);
  if (w <= 0 || h <= 0) return 0;
  const area = (box.right - box.left) * (box.top - box.bottom);
  return area > 0 ? (w * h) / area : 0;
}

/**
 * The quote under some quads: a glyph is under a quad when at least half of
 * its tight box lies inside it (§ Annotation identity, *Quote derivation*).
 * Half rather than the glyph's centre, because Preview's quads hug the text
 * and a drag that ends mid-glyph would otherwise lose its first and last
 * letters. Covered glyphs are joined in the page's reading order; a hyphen
 * at a line end is dropped so `down-` / `stream` reads `downstream`.
 */
function quoteUnder(chars: Glyph[], quads: number[][]): string {
  const rects = quads.map(quadRect);
  let quote = "";
  let previous = -1;
  chars.forEach((c, i) => {
    if (c.generated) return;
    if (c.ch.trim() === "" && !c.hyphen) return;
    if (!rects.some((rect) => overlapFraction(c.box, rect) >= 0.5)) return;
    if (previous >= 0 && i > previous + 1) {
      const between = chars.slice(previous + 1, i);
      const hyphenated =
        between.some((b) => b.hyphen) || chars[previous]!.hyphen;
      if (!hyphenated) quote += " ";
    }
    previous = i;
    if (!c.hyphen) quote += c.ch;
  });
  return quote.replace(/\s+/g, " ").trim();
}

function readAnnotation(
  m: Module,
  annot: number,
  page: number,
  chars: () => Glyph[]
) {
  const kind = KINDS[m.FPDFAnnot_GetSubtype(annot)];
  if (kind === undefined) return null;
  const mem = scratch(m);
  try {
    const rect = mem.alloc(16);
    m.FPDFAnnot_GetRect(annot, rect);
    // FS_RECTF is { left, top, right, bottom }.
    const [left, top, right, bottom] = mem.f32(rect, 4) as [
      number,
      number,
      number,
      number,
    ];
    const [r, g, b, a] = [
      mem.alloc(4),
      mem.alloc(4),
      mem.alloc(4),
      mem.alloc(4),
    ];
    // Stock GetColor refuses once an /AP exists, which every annotation
    // Vitrine writes has; the fork's reads /C regardless (§ Decided, ADR 0007).
    const color = m.FPDFAnnot_GetColor(annot, 0, r, g, b, a)
      ? [mem.u32(r), mem.u32(g), mem.u32(b)]
      : m.EPDFAnnot_GetColor(annot, 0, r, g, b)
        ? [mem.u32(r), mem.u32(g), mem.u32(b)]
        : null;
    const quads: number[][] = [];
    if (MARKUP.has(kind)) {
      const count = m.FPDFAnnot_CountAttachmentPoints(annot);
      const q = mem.alloc(32);
      for (let i = 0; i < count; i++) {
        m.FPDFAnnot_GetAttachmentPoints(annot, i, q);
        quads.push(mem.f32(q, 8));
      }
    }
    const contents = annotString(m, annot, "Contents") ?? "";
    const nm = annotString(m, annot, "NM");
    const author = annotString(m, annot, "T");
    const isText = kind === "text" || kind === "freetext";
    return {
      kind,
      page,
      quads,
      quote: MARKUP.has(kind)
        ? quoteUnder(chars(), quads)
        : isText
          ? contents.trim()
          : "",
      note: MARKUP.has(kind) ? contents : "",
      color,
      ...(nm === undefined || nm === "" ? {} : { nm }),
      rect: [left, bottom, right, top],
      ...(author === undefined || author === "" ? {} : { author }),
      hasAppearance: Boolean(m.EPDFAnnot_HasAppearanceStream(annot, 0)),
    };
  } finally {
    mem.free();
  }
}

const readAnnotations = (bytes: Uint8Array) =>
  withDocument(bytes, (m, doc) => {
    const pages = m.FPDF_GetPageCount(doc);
    const mem = scratch(m);
    let fileId = "";
    try {
      const length = m.FPDF_GetFileIdentifier(doc, 0, 0, 0);
      if (length > 0) {
        const ptr = mem.alloc(length);
        m.FPDF_GetFileIdentifier(doc, 0, ptr, length);
        fileId = Buffer.from(heap(m).subarray(ptr, ptr + length)).toString(
          "hex"
        );
      }
    } finally {
      mem.free();
    }
    const annotations = [];
    const pageText: string[] = [];
    for (let index = 0; index < pages; index++) {
      const page = m.FPDF_LoadPage(doc, index);
      if (!page) {
        pageText.push("");
        continue;
      }
      let cached: Glyph[] | null = null;
      try {
        const count = m.FPDFPage_GetAnnotCount(page);
        for (let i = 0; i < count; i++) {
          const annot = m.FPDFPage_GetAnnot(page, i);
          try {
            const read = readAnnotation(
              m,
              annot,
              index,
              () => (cached ??= glyphs(m, page))
            );
            if (read !== null) annotations.push(read);
          } finally {
            m.FPDFPage_CloseAnnot(annot);
          }
        }
        // The document fingerprint's input, read on every page whether or not
        // it holds an annotation: a page nothing was drawn on can still be
        // the one that shows the document was replaced.
        pageText.push(
          (cached ??= glyphs(m, page))
            .filter((c) => !c.generated && !c.hyphen)
            .map((c) => c.ch)
            .join("")
        );
      } finally {
        m.FPDF_ClosePage(page);
      }
    }
    return { pages, fileId, annotations, pageText };
  });

const rectQuad = ({ left, right, bottom, top }: Rect) => [
  left,
  top,
  right,
  top,
  left,
  bottom,
  right,
  bottom,
];

/**
 * The characters a selection covers, gathered into one rectangle per line of
 * text and sized by the loose boxes (full line height), which is what a
 * viewer's own highlighter fills. A glyph is covered by the same half-inside
 * rule the quote is read back by, so the two cannot disagree.
 */
function snap(chars: Glyph[], rects: Rect[]): Rect[] {
  const lines: Array<{ rect: Rect; last: number }> = [];
  chars.forEach((c, i) => {
    if (c.generated || (c.ch.trim() === "" && !c.hyphen)) return;
    if (!rects.some((rect) => overlapFraction(c.box, rect) >= 0.5)) return;
    const current = lines.at(-1);
    const height = c.loose.top - c.loose.bottom;
    const breaks =
      current !== undefined &&
      (chars
        .slice(current.last + 1, i)
        .some((b) => b.generated && /[\r\n]/.test(b.ch)) ||
        Math.abs(c.loose.bottom - current.rect.bottom) > height * 0.5);
    if (current === undefined || breaks) {
      lines.push({ rect: { ...c.loose }, last: i });
      return;
    }
    current.rect.left = Math.min(current.rect.left, c.loose.left);
    current.rect.right = Math.max(current.rect.right, c.loose.right);
    current.rect.bottom = Math.min(current.rect.bottom, c.loose.bottom);
    current.rect.top = Math.max(current.rect.top, c.loose.top);
    current.last = i;
  });
  return lines.map((l) => l.rect);
}

// D:YYYYMMDDHHmmSS+HH'mm' with the local offset, as PDF dates are written.
function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(Math.abs(offset) / 60))}'${p(Math.abs(offset) % 60)}'`
  );
}

/** A full rewrite of the loaded document, PDFium's flag 2, never the incremental save (ADR 0007 decision 12). */
function saveRewritten(m: Module, doc: number): Uint8Array {
  const chunks: Buffer[] = [];
  const pdfium = m.pdfium as unknown as {
    HEAPU8: Uint8Array;
    HEAP32: Int32Array;
    addFunction: (fn: (...a: number[]) => number, sig: string) => number;
    removeFunction: (ptr: number) => void;
  };
  const write = pdfium.addFunction((_self, data, size) => {
    chunks.push(Buffer.from(pdfium.HEAPU8.subarray(data, data + size)));
    return 1;
  }, "iiii");
  const mem = scratch(m);
  try {
    // struct FPDF_FILEWRITE { int version; WriteBlock fn; }
    const target = mem.alloc(8);
    pdfium.HEAP32[target / 4] = 1;
    pdfium.HEAP32[target / 4 + 1] = write;
    if (!m.FPDF_SaveAsCopy(doc, target, 2)) {
      throw new Error("PDFium could not save the file");
    }
    return Buffer.concat(chunks);
  } finally {
    mem.free();
    pdfium.removeFunction(write);
  }
}

const writeHighlight = (bytes: Uint8Array, request: HighlightRequest) =>
  withDocument(bytes, (m, doc): HighlightResult => {
    const page = m.FPDF_LoadPage(doc, request.page);
    if (!page) {
      return { written: false, reason: "That page is not in this PDF." };
    }
    const mem = scratch(m);
    try {
      const chars = glyphs(m, page, true);
      const rects = snap(
        chars,
        request.rects.map(([left, bottom, right, top]) => ({
          left: left!,
          bottom: bottom!,
          right: right!,
          top: top!,
        }))
      );
      const quads = rects.map(rectQuad);
      // From the quads about to be written, by the function Ingest reads them
      // back with: the sidecar's quote and the next Ingest's cannot differ.
      const quote = quoteUnder(chars, quads);
      if (quote === "") {
        return {
          written: false,
          reason:
            "There is no text under that selection — it may be an image, or a scanned page — so it cannot be highlighted.",
        };
      }
      const annot = m.FPDFPage_CreateAnnot(page, 9);
      if (!annot) throw new Error("PDFium could not create the annotation");
      try {
        const wide = (value: string) => {
          const text = Buffer.from(`${value}\0`, "utf16le");
          const ptr = mem.alloc(text.length);
          heap(m).set(text, ptr);
          return ptr;
        };
        const floats = (values: number[]) => {
          const ptr = mem.alloc(values.length * 4);
          (m.pdfium as unknown as { HEAPF32: Float32Array }).HEAPF32.set(
            values,
            ptr / 4
          );
          return ptr;
        };
        for (const quad of quads) {
          if (!m.FPDFAnnot_AppendAttachmentPoints(annot, floats(quad))) {
            throw new Error("PDFium refused a quad");
          }
        }
        const extent = rects.reduce((a, r) => ({
          left: Math.min(a.left, r.left),
          right: Math.max(a.right, r.right),
          bottom: Math.min(a.bottom, r.bottom),
          top: Math.max(a.top, r.top),
        }));
        // FS_RECTF is { left, top, right, bottom }.
        m.FPDFAnnot_SetRect(
          annot,
          floats([extent.left, extent.top, extent.right, extent.bottom])
        );
        const [r, g, b] = request.color as [number, number, number];
        m.FPDFAnnot_SetColor(annot, 0, r, g, b, 255);
        const at = pdfDate(new Date(request.at));
        // /T is the user, because Preview shows it on every note; /Contents
        // is the note and nothing else, because every viewer shows it.
        for (const [key, value] of [
          ["NM", request.nm],
          ["T", request.author],
          ["Contents", request.note],
          ["Subj", "Highlight"],
          ["CreationDate", at],
          ["M", at],
        ] as const) {
          if (!m.FPDFAnnot_SetStringValue(annot, key, wide(value))) {
            throw new Error(`PDFium refused /${key}`);
          }
        }
        if (!m.EPDFAnnot_GenerateAppearance(annot)) {
          throw new Error("PDFium could not draw the highlight");
        }
      } finally {
        m.FPDFPage_CloseAnnot(annot);
      }
      return { written: true, bytes: saveRewritten(m, doc), quote, quads };
    } finally {
      mem.free();
      m.FPDF_ClosePage(page);
    }
  });

parentPort?.on("message", ({ id, job, args, bytes }: Job) => {
  (job === "annotations"
    ? readAnnotations(bytes)
    : job === "highlight"
      ? writeHighlight(bytes, args as HighlightRequest)
      : readMetadata(bytes)
  ).then(
    (result) => parentPort?.postMessage({ id, result }),
    () =>
      parentPort?.postMessage({
        id,
        result: { unreadable: "the reader stopped on it" },
      })
  );
});
