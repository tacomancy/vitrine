// Regenerates the annotated PDF fixtures. Run from anywhere:
// `node regenerate-annotated.mjs`. Never run in CI (spec #416 § Testing
// Decisions): the outputs are committed, and this needs macOS and `swift`.
//
// `synthetic-body.pdf` is written byte by byte — two pages of invented
// sentences with a known text layer, one of them broken across a line at a
// hyphen. `annotated.pdf` is that file annotated and saved by PDFKit, which
// is what Preview is made of, so the annotations carry the structure a
// Preview save leaves: no /NM, quads as PDFKit wrote them, a new document
// id. `annotated-again.pdf` is the same document annotated differently, for
// the run that follows. Nothing here is a real paper.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  [
    "Sleep spindles were counted during slow wave sleep.",
    "Participants who heard the odor cue recalled more of the invented word pairs",
    "and the difference was reliable across the down-",
    "stream analyses of the second night.",
  ],
  [
    "A second page carries a different sentence about memory.",
    "Another line follows here for a highlight.",
  ],
];

function body(PAGES) {
  const objects = [];
  const add = (text) => objects.push(text) && objects.length;
  const catalog = add("");
  const pagesObject = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = PAGES.map((lines) => {
    const stream = lines
      .map((line, i) => `BT /F1 12 Tf 72 ${700 - i * 18} Td (${line}) Tj ET`)
      .join("\n");
    const contents = add(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
    return add(
      `<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`;
  objects[pagesObject - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = objects.map((text, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${text}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const dir = mkdtempSync(join(tmpdir(), "vitrine-annotated-"));

// The other documents the re-matching fixtures need. Each is `synthetic-body`
// changed in exactly one way: a line inserted above the first (every word on
// it already on the page, so the fingerprint is unmoved — reflow, not a new
// document), the two pages in the other order (a re-export), all-new text (a
// replaced document), and four identical lines (twin highlights).
const BODIES = {
  "synthetic-body.pdf": PAGES,
  "synthetic-shifted.pdf": [
    ["Second night of slow wave sleep.", ...PAGES[0]],
    PAGES[1],
  ],
  "synthetic-swapped.pdf": [PAGES[1], PAGES[0]],
  "synthetic-other.pdf": [
    [
      "Granite quarries supplied the harbour walls throughout winter.",
      "Masons dressed every block beside the northern slipway",
      "before merchants shipped cargo toward distant markets.",
    ],
    [
      "Tidal charts recorded unusual currents near the lighthouse.",
      "Keepers logged storms alongside routine repairs.",
    ],
  ],
  "synthetic-twins.pdf": [
    [
      "Twin sentence here.",
      "Twin sentence here.",
      "Twin sentence here.",
      "Twin sentence here.",
    ],
  ],
};
for (const [name, pages] of Object.entries(BODIES)) {
  writeFileSync(join(here, name), body(pages));
}

// What each output is given, as JSON the Swift below reads: a highlight is a
// phrase to find and an optional note; a note is a point; ink is a stroke.
const specs = {
  "annotated.pdf": [
    {
      kind: "highlight",
      phrase: "Participants who heard the odor cue",
      contents: "Check this against the control group",
    },
    {
      kind: "highlight",
      phrase: "difference was reliable across the down-",
      also: "stream analyses",
    },
    { kind: "note", page: 0, x: 420, y: 600, contents: "Ask Ana about this" },
    {
      kind: "ink",
      page: 1,
      points: [
        [100, 500],
        [160, 540],
        [220, 500],
      ],
    },
    { kind: "stamp", page: 1, x: 300, y: 400 },
    { kind: "highlight", phrase: "different sentence about memory" },
  ],
  // The `Q:` convention (#422): a note that spawns, in either case and after
  // leading spaces, one that is only the prefix, and a near miss.
  "annotated-questions.pdf": [
    {
      kind: "highlight",
      phrase: "Participants who heard the odor cue",
      contents: "Q: Does the cue work without sleep?",
    },
    {
      kind: "highlight",
      phrase: "Sleep spindles were counted",
      contents: "  q:Are spindles the mechanism",
    },
    {
      kind: "highlight",
      phrase: "different sentence about memory",
      contents: "Q:",
    },
    {
      kind: "highlight",
      phrase: "Another line follows here",
      contents: "Q ; a near miss",
    },
    {
      kind: "note",
      page: 0,
      x: 420,
      y: 600,
      contents: "Q: Who ran the control?",
    },
  ],
  "annotated-again.pdf": [
    { kind: "highlight", phrase: "Another line follows here for a highlight" },
  ],
};

// What a re-save and the ordinary edits to an annotated file look like once
// PDFKit has written them (spec #416 story 34–39). Each starts from another
// output rather than from a body: a Preview edit is made to a file that is
// already annotated. `remove` and `nudge` find the highlight covering a phrase.
const PARTICIPANTS = {
  kind: "highlight",
  contents: "Check this against the control group",
};
const derived = {
  "resaved.pdf": { base: "annotated.pdf", ops: [] },
  "annotated-nudged.pdf": {
    base: "annotated.pdf",
    ops: [{ kind: "nudge", covering: "Participants who", dx: 1.5, dy: -2 }],
  },
  "annotated-extended.pdf": {
    base: "annotated.pdf",
    ops: [
      { kind: "remove", covering: "Participants who" },
      {
        ...PARTICIPANTS,
        phrase: "Participants who heard the odor cue recalled more",
      },
    ],
  },
  "annotated-trimmed.pdf": {
    base: "annotated.pdf",
    ops: [
      { kind: "remove", covering: "Participants who" },
      { ...PARTICIPANTS, phrase: "Participants who heard the" },
    ],
  },
  // Two trims measured against the 0.4 threshold: half the highlight keeps
  // 0.5 of its box, a single word 0.35 — one is the same highlight, the
  // other is not, and each is what stops the threshold moving unnoticed.
  "annotated-halved.pdf": {
    base: "annotated.pdf",
    ops: [
      { kind: "remove", covering: "Participants who" },
      { ...PARTICIPANTS, phrase: "Participants who" },
    ],
  },
  "annotated-sliver.pdf": {
    base: "annotated.pdf",
    ops: [
      { kind: "remove", covering: "Participants who" },
      { ...PARTICIPANTS, phrase: "Participants" },
    ],
  },
  "annotated-fewer.pdf": {
    base: "annotated.pdf",
    ops: [{ kind: "remove", covering: "difference was reliable" }],
  },
  "twins.pdf": {
    base: "synthetic-twins.pdf",
    ops: [
      { kind: "highlight", phrase: "Twin sentence here.", occurrence: 0 },
      { kind: "highlight", phrase: "Twin sentence here.", occurrence: 1 },
    ],
  },
  "twins-resaved.pdf": { base: "twins.pdf", ops: [] },
  "twins-moved.pdf": {
    base: "synthetic-twins.pdf",
    ops: [
      { kind: "highlight", phrase: "Twin sentence here.", occurrence: 2 },
      { kind: "highlight", phrase: "Twin sentence here.", occurrence: 3 },
    ],
  },
  "annotated-shifted.pdf": {
    base: "synthetic-shifted.pdf",
    ops: [
      { ...PARTICIPANTS, phrase: "Participants who heard the odor cue" },
      {
        kind: "highlight",
        phrase: "difference was reliable across the down-",
        also: "stream analyses",
      },
      { kind: "highlight", phrase: "different sentence about memory" },
    ],
  },
  "annotated-swapped.pdf": {
    base: "synthetic-swapped.pdf",
    ops: [
      { ...PARTICIPANTS, phrase: "Participants who heard the odor cue" },
      { kind: "highlight", phrase: "different sentence about memory" },
    ],
  },
  "replaced.pdf": {
    base: "synthetic-other.pdf",
    ops: [
      // On lines that share no box with anything the file it replaces had
      // marked: a replacement is not the place to test the geometry tier.
      { kind: "highlight", phrase: "Granite quarries supplied" },
      { kind: "highlight", phrase: "Keepers logged storms" },
    ],
  },
};

const swift = join(dir, "annotate.swift");
writeFileSync(
  swift,
  `import PDFKit
import AppKit
import Foundation

let a = CommandLine.arguments
guard let doc = PDFDocument(url: URL(fileURLWithPath: a[1])) else { exit(1) }
let specs = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[3]))) as! [[String: Any]]

func lineRects(_ selection: PDFSelection) -> [(PDFPage, CGRect)] {
  var out: [(PDFPage, CGRect)] = []
  for line in selection.selectionsByLine() {
    for page in line.pages { out.append((page, line.bounds(for: page))) }
  }
  return out
}

for spec in specs {
  switch spec["kind"] as! String {
  case "remove":
    guard let found = doc.findString(spec["covering"] as! String, withOptions: .literal).first, let page = found.pages.first else { fputs("not found\\n", stderr); exit(1) }
    let at = found.bounds(for: page)
    for existing in page.annotations where existing.bounds.intersects(at) && existing.type == "Highlight" { page.removeAnnotation(existing) }
  case "nudge":
    guard let found = doc.findString(spec["covering"] as! String, withOptions: .literal).first, let page = found.pages.first else { fputs("not found\\n", stderr); exit(1) }
    let at = found.bounds(for: page)
    for existing in page.annotations where existing.bounds.intersects(at) && existing.type == "Highlight" {
      existing.bounds = existing.bounds.offsetBy(dx: spec["dx"] as! Double, dy: spec["dy"] as! Double)
    }
  case "highlight":
    let hits = doc.findString(spec["phrase"] as! String, withOptions: .literal)
    guard let found = hits.count > (spec["occurrence"] as? Int ?? 0) ? hits[spec["occurrence"] as? Int ?? 0] : nil else { fputs("not found\\n", stderr); exit(1) }
    var lines = lineRects(found)
    if let also = spec["also"] as? String, let more = doc.findString(also, withOptions: .literal).first {
      lines += lineRects(more)
    }
    let page = lines[0].0
    let bounds = lines.map { $0.1 }.reduce(CGRect.null) { $0.union($1) }
    let mark = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
    mark.quadrilateralPoints = lines.flatMap { (_, r) -> [NSValue] in
      [(r.minX, r.maxY), (r.maxX, r.maxY), (r.minX, r.minY), (r.maxX, r.minY)].map {
        NSValue(point: NSPoint(x: $0.0 - bounds.minX, y: $0.1 - bounds.minY))
      }
    }
    mark.color = NSColor(red: 1, green: 0.85, blue: 0.2, alpha: 1)
    mark.contents = spec["contents"] as? String
    mark.userName = "Preview user"
    page.addAnnotation(mark)
  case "note":
    let page = doc.page(at: spec["page"] as! Int)!
    let note = PDFAnnotation(bounds: CGRect(x: spec["x"] as! Double, y: spec["y"] as! Double, width: 20, height: 20), forType: .text, withProperties: nil)
    note.contents = spec["contents"] as? String
    note.userName = "Preview user"
    page.addAnnotation(note)
  case "ink":
    let page = doc.page(at: spec["page"] as! Int)!
    let pts = (spec["points"] as! [[Double]]).map { NSPoint(x: $0[0], y: $0[1]) }
    let path = NSBezierPath()
    path.move(to: pts[0])
    for p in pts.dropFirst() { path.line(to: p) }
    let ink = PDFAnnotation(bounds: path.bounds.insetBy(dx: -4, dy: -4), forType: .ink, withProperties: nil)
    ink.add(path)
    ink.color = .systemBlue
    page.addAnnotation(ink)
  case "stamp":
    let page = doc.page(at: spec["page"] as! Int)!
    let stamp = PDFAnnotation(bounds: CGRect(x: spec["x"] as! Double, y: spec["y"] as! Double, width: 40, height: 20), forType: .stamp, withProperties: nil)
    page.addAnnotation(stamp)
  default: exit(2)
  }
}
doc.write(to: URL(fileURLWithPath: a[2]))
`
);

const run = (base, name, spec) => {
  const json = join(dir, `${name}.json`);
  writeFileSync(json, JSON.stringify(spec));
  execFileSync("swift", [swift, join(here, base), join(here, name), json]);
};
for (const [name, spec] of Object.entries(specs)) {
  run("synthetic-body.pdf", name, spec);
}
// In order: `twins-resaved` starts from `twins`.
for (const [name, { base, ops }] of Object.entries(derived)) {
  run(base, name, ops);
}
