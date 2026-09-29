// Regenerates the PDF fixtures. Run from anywhere: `node regenerate.mjs`.
//
// Nothing here is a real paper: the text is invented, the metadata is
// invented, and so no third-party text is committed (spec #416). The
// synthetic files are written byte by byte; the PDFKit-saved and encrypted
// ones are the same document pushed through PDFKit — what Preview is made
// of — so they carry the structure a Preview save leaves. That step needs
// macOS and `swift`; the outputs are committed so nothing else does.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A one-page PDF whose Info dictionary is exactly `info` (raw PDF strings). */
function pdf(info) {
  const stream =
    "BT /F1 18 Tf 72 700 Td (An invented sentence about sleep.) Tj ET";
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const keys = Object.entries(info);
  if (keys.length > 0) {
    bodies.push(`<< ${keys.map(([k, v]) => `/${k} ${v}`).join(" ")} >>`);
  }
  let out = "%PDF-1.4\n";
  const offsets = [];
  bodies.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R${
    keys.length > 0 ? ` /Info ${bodies.length} 0 R` : ""
  } >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const write = (name, bytes) => writeFileSync(join(here, name), bytes);

write(
  "synthetic-info.pdf",
  pdf({
    Title: "(Odor cues and the invented night)",
    Author: "(Jens G. Klinzing; Jan Born)",
  })
);
write("synthetic-no-title.pdf", pdf({ Author: "(Ana Reyes)" }));
write("synthetic-no-info.pdf", pdf({}));

// PDFKit rewrites a file the way Preview does, and can lock one.
const swift = join(mkdtempSync(join(tmpdir(), "vitrine-pdf-")), "resave.swift");
writeFileSync(
  swift,
  `import PDFKit
import Foundation
let a = CommandLine.arguments
let doc = PDFDocument(url: URL(fileURLWithPath: a[1]))!
doc.write(to: URL(fileURLWithPath: a[2]))
doc.write(to: URL(fileURLWithPath: a[3]), withOptions: [
  .userPasswordOption: "invented", .ownerPasswordOption: "invented"])
`
);
execFileSync("swift", [
  swift,
  join(here, "synthetic-info.pdf"),
  join(here, "pdfkit-saved.pdf"),
  join(here, "encrypted.pdf"),
]);
