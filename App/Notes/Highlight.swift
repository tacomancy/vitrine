import AppKit
import NoteParsing

/// One range of the open note's text the editor draws differently — a
/// token or structure the parser reported — in UTF-16 units, the text
/// view's coordinates (ADR 0013). `all` converts every range on one
/// native-storage snapshot, once per pass.
struct Highlight {
    enum Kind {
        case frontmatter
        case heading(level: Int)
        case fencedCode
        case inlineCode
        case tag
        /// The link at this index of the `BodyLink`s the highlights were built with.
        case link(index: Int)
    }

    let range: NSRange
    let kind: Kind

    /// Every highlight of `parsed`, later kinds over earlier where they nest:
    /// frontmatter, code, headings, then tags and links, which take their
    /// own color inside any of the others.
    static func all(in parsed: ParsedNote, links: [BodyLink]) -> [Highlight] {
        let text = parsed.text
        let utf8 = text.utf8
        // O(1) per index on native UTF-8 storage; a bridged string would
        // walk from the start each time.
        func converted(_ range: Range<Int>) -> NSRange {
            let lower = utf8.index(utf8.startIndex, offsetBy: range.lowerBound)
            let upper = utf8.index(utf8.startIndex, offsetBy: range.upperBound)
            return NSRange(lower..<upper, in: text)
        }
        var highlights: [Highlight] = []
        if let frontmatter = parsed.frontmatter {
            highlights.append(Highlight(range: converted(frontmatter.rawRange), kind: .frontmatter))
        }
        highlights += parsed.structure.fencedCodeBlocks.map {
            Highlight(range: converted($0), kind: .fencedCode)
        }
        highlights += parsed.structure.inlineCodeSpans.map {
            Highlight(range: converted($0), kind: .inlineCode)
        }
        highlights += parsed.structure.headings.map {
            Highlight(range: converted($0.range), kind: .heading(level: $0.level))
        }
        highlights += parsed.bodyTags.map { Highlight(range: converted($0.range), kind: .tag) }
        highlights += links.enumerated().map { index, link in
            Highlight(range: converted(link.range), kind: .link(index: index))
        }
        return highlights
    }

    /// The font each highlight sets, or nil for one that only colors.
    var font: NSFont? {
        switch kind {
        case .frontmatter, .fencedCode, .inlineCode: EditorFont.mono
        case .heading(let level): EditorFont.heading(level: level)
        case .tag, .link: nil
        }
    }

    /// The text's fonts as contiguous spans over `length`: the body's, a
    /// heading's over its line, mono over code and frontmatter — the last
    /// begun wins where they nest, and the parser's structure nests or is
    /// disjoint, never partially overlapping. Spans, so the text view sets
    /// a font only where the one in place differs.
    static func fontSpans(of highlights: [Highlight], length: Int) -> [(
        range: NSRange, font: NSFont
    )] {
        struct Boundary {
            let position: Int
            let isStart: Bool
            let font: NSFont
        }
        let boundaries = highlights.compactMap { highlight -> [Boundary]? in
            highlight.font.map { font in
                [
                    Boundary(position: highlight.range.location, isStart: true, font: font),
                    Boundary(
                        position: highlight.range.location + highlight.range.length,
                        isStart: false, font: font),
                ]
            }
        }
        .flatMap { $0 }
        // An end before a start at the same position, so nothing is active for zero length.
        .sorted { ($0.position, $0.isStart ? 1 : 0) < ($1.position, $1.isStart ? 1 : 0) }
        var spans: [(range: NSRange, font: NSFont)] = []
        var active: [NSFont] = []
        var cursor = 0
        for boundary in boundaries {
            if boundary.position > cursor {
                spans.append(
                    (
                        NSRange(location: cursor, length: boundary.position - cursor),
                        active.last ?? EditorFont.body
                    ))
                cursor = boundary.position
            }
            if boundary.isStart {
                active.append(boundary.font)
            } else if let index = active.lastIndex(of: boundary.font) {
                active.remove(at: index)
            }
        }
        if cursor < length {
            spans.append((NSRange(location: cursor, length: length - cursor), EditorFont.body))
        }
        return spans
    }
}
