import AppKit
import NoteParsing

/// One range of the open note's text the editor draws for what the parser
/// says it is — a token or structure — in UTF-16 units, the text view's
/// coordinates (ADR 0013), with the font and colors that go with it.
/// `all` converts every range on one native-storage snapshot, once per pass.
struct StyledRange {
    enum Kind {
        case frontmatter
        case heading(level: Int)
        case fencedCode
        case inlineCode
        case tag
        /// The link at this index of the `BodyLink`s the ranges were built
        /// with; unresolved, it is drawn as no link at all.
        case link(index: Int, isResolved: Bool)
    }

    /// A stretch of the text and the font it takes.
    struct FontSpan {
        let range: NSRange
        let font: NSFont
    }

    let range: NSRange
    let kind: Kind

    /// Every styled range of `parsed`, later kinds over earlier where they
    /// nest: frontmatter, code, headings, then tags and links, which take
    /// their own color inside any of the others.
    static func all(in parsed: ParsedNote, links: [BodyLink]) -> [StyledRange] {
        let text = parsed.text
        let utf8 = text.utf8
        // O(1) per index on native UTF-8 storage; a bridged string would
        // walk from the start each time.
        func converted(_ range: Range<Int>) -> NSRange {
            let lower = utf8.index(utf8.startIndex, offsetBy: range.lowerBound)
            let upper = utf8.index(utf8.startIndex, offsetBy: range.upperBound)
            return NSRange(lower..<upper, in: text)
        }
        var ranges: [StyledRange] = []
        if let frontmatter = parsed.frontmatter {
            ranges.append(StyledRange(range: converted(frontmatter.rawRange), kind: .frontmatter))
        }
        ranges += parsed.structure.fencedCodeBlocks.map {
            StyledRange(range: converted($0), kind: .fencedCode)
        }
        ranges += parsed.structure.inlineCodeSpans.map {
            StyledRange(range: converted($0), kind: .inlineCode)
        }
        ranges += parsed.structure.headings.map {
            StyledRange(range: converted($0.range), kind: .heading(level: $0.level))
        }
        ranges += parsed.bodyTags.map { StyledRange(range: converted($0.range), kind: .tag) }
        ranges += links.enumerated().map { index, link in
            let isResolved =
                if case .unresolved = link.destination { false } else { true }
            return StyledRange(
                range: converted(link.range), kind: .link(index: index, isResolved: isResolved))
        }
        return ranges
    }

    /// The font this range sets, or nil for one that only colors.
    var font: NSFont? {
        switch kind {
        case .frontmatter, .fencedCode, .inlineCode: EditorFont.mono
        case .heading(let level): EditorFont.heading(level: level)
        case .tag, .link: nil
        }
    }

    /// The colors this range draws in (docs/visual-implementation.md, The
    /// editor): links and tags `link`, an unresolved link `fg-muted`,
    /// frontmatter `fg-muted`, code `fg-secondary` on `bg-sunken`; a
    /// heading keeps `fg`. Every key is one of `renderingKeys`.
    var renderingAttributes: [NSAttributedString.Key: Any] {
        switch kind {
        case .frontmatter, .link(_, isResolved: false):
            [.foregroundColor: NSColor(resource: .fgMuted)]
        case .fencedCode, .inlineCode:
            [
                .foregroundColor: NSColor(resource: .fgSecondary),
                .backgroundColor: NSColor(resource: .bgSunken),
            ]
        case .heading:
            [:]
        case .tag, .link(_, isResolved: true):
            [.foregroundColor: NSColor(resource: .link)]
        }
    }

    /// The rendering attributes the editor owns — the ones it clears before
    /// setting afresh, leaving the view's own (spelling, marked text) alone.
    static let renderingKeys: [NSAttributedString.Key] = [.foregroundColor, .backgroundColor]

    /// The unresolved link's dashed underline. A storage attribute, not a
    /// rendering one: TextKit 2 draws underlines from the storage alone.
    static let unresolvedUnderline = NSUnderlineStyle([.single, .patternDash]).rawValue

    /// Whether this range is an unresolved link, drawn as no link at all.
    var isUnresolvedLink: Bool {
        if case .link(_, isResolved: false) = kind { true } else { false }
    }

    /// The text's fonts as contiguous spans over `length`: the body's, a
    /// heading's over its line, mono over code and frontmatter — the last
    /// begun wins where they nest, and the parser's structure nests or is
    /// disjoint, never partially overlapping. Spans, so the text view sets
    /// a font only where the one in place differs.
    static func fontSpans(of ranges: [StyledRange], length: Int) -> [FontSpan] {
        struct Boundary {
            let position: Int
            let isStart: Bool
            let font: NSFont
        }
        let boundaries = ranges.compactMap { styled -> [Boundary]? in
            styled.font.map { font in
                [
                    Boundary(position: styled.range.location, isStart: true, font: font),
                    Boundary(
                        position: styled.range.location + styled.range.length,
                        isStart: false, font: font),
                ]
            }
        }
        .flatMap { $0 }
        // An end before a start at the same position, so nothing is active for zero length.
        .sorted { ($0.position, $0.isStart ? 1 : 0) < ($1.position, $1.isStart ? 1 : 0) }
        var spans: [FontSpan] = []
        var active: [NSFont] = []
        var cursor = 0
        for boundary in boundaries {
            if boundary.position > cursor {
                spans.append(
                    FontSpan(
                        range: NSRange(location: cursor, length: boundary.position - cursor),
                        font: active.last ?? EditorFont.body))
                cursor = boundary.position
            }
            if boundary.isStart {
                active.append(boundary.font)
            } else if let index = active.lastIndex(of: boundary.font) {
                active.remove(at: index)
            }
        }
        if cursor < length {
            spans.append(
                FontSpan(
                    range: NSRange(location: cursor, length: length - cursor), font: EditorFont.body
                ))
        }
        return spans
    }
}
