// The stand-in for Preview (which is PDFKit): opens a PDF, removes the
// highlights covering some phrases, adds highlights over others, and saves
// it again — the shape of an edit made on an iPad. Used by the Reader demo
// (`Scripts/reader-demo.mjs`); the fixtures' own generator is
// packages/core/fixtures/pdf/regenerate-annotated.mjs.
//
//   swift preview-resave.swift in.pdf out.pdf --remove "phrase" --add "phrase"
import PDFKit
import AppKit
import Foundation

let a = CommandLine.arguments
guard let doc = PDFDocument(url: URL(fileURLWithPath: a[1])) else { exit(1) }

var i = 3
while i + 1 < a.count {
  let flag = a[i], phrase = a[i + 1]
  i += 2
  guard let found = doc.findString(phrase, withOptions: .literal).first, let page = found.pages.first else {
    fputs("not found: \(phrase)\n", stderr); exit(1)
  }
  let at = found.bounds(for: page)
  if flag == "--remove" {
    for existing in page.annotations where existing.bounds.intersects(at) && existing.type == "Highlight" {
      page.removeAnnotation(existing)
    }
  } else {
    let mark = PDFAnnotation(bounds: at, forType: .highlight, withProperties: nil)
    mark.quadrilateralPoints = [(at.minX, at.maxY), (at.maxX, at.maxY), (at.minX, at.minY), (at.maxX, at.minY)].map {
      NSValue(point: NSPoint(x: $0.0 - at.minX, y: $0.1 - at.minY))
    }
    mark.color = NSColor(red: 1, green: 0.85, blue: 0.2, alpha: 1)
    mark.userName = "Preview user"
    page.addAnnotation(mark)
  }
}
doc.write(to: URL(fileURLWithPath: a[2]))
