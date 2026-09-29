// The PDF engine's worker thread (`pdf-engine.ts` owns the other end). It
// imports nothing from the core: it runs from the built `dist/` and, under
// Node's type stripping, straight from source in tests, and either way the
// only specifier it may name is a package or a `node:` builtin.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import { init } from "@embedpdf/pdfium";

type Job = { id: number; bytes: Uint8Array };

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

async function read(bytes: Uint8Array) {
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
    return {
      title: metaText(m, doc, "Title"),
      author: metaText(m, doc, "Author"),
    };
  } finally {
    m.FPDF_CloseDocument(doc);
    m.pdfium.wasmExports.free(ptr);
  }
}

parentPort?.on("message", ({ id, bytes }: Job) => {
  read(bytes).then(
    (result) => parentPort?.postMessage({ id, result }),
    () =>
      parentPort?.postMessage({
        id,
        result: { unreadable: "the reader stopped on it" },
      })
  );
});
