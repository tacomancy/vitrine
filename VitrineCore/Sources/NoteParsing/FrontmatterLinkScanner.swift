import Yams

/// Finds the wikilinks written inside a frontmatter block's string values —
/// scalars and list items under any key — and places each in the note by
/// its UTF-8 range. Obsidian reads `sources: ["[[Title]]"]` as a link like
/// any other (CONTEXT.md § Links); a Markdown link or `#tag` in a value is
/// not recognised, as in Obsidian.
struct FrontmatterLinkScanner {
    private let text: [UInt8]
    /// The block's YAML lines, in order, as they were composed.
    private let lines: [String]
    /// `lineStarts[i]` is the UTF-8 offset of `lines[i]` in the note.
    private let lineStarts: [Int]

    /// `lines` are the block's YAML lines, the first beginning at UTF-8
    /// offset `firstLineStart` of `text`.
    init(text: String, lines: [String], firstLineStart: Int) {
        self.text = Array(text.utf8)
        self.lines = lines
        var lineStarts = [firstLineStart]
        for line in lines.dropLast() {
            lineStarts.append(lineStarts[lineStarts.count - 1] + line.utf8.count + 1)
        }
        self.lineStarts = lineStarts
    }

    /// Every wikilink in `root`'s string values, in document order.
    func links(in root: Node?) -> [Wikilink] {
        guard let root else { return [] }
        return values(in: root).flatMap(links(in:))
    }

    /// The string scalars under `node`, with their marks, in document order.
    /// Keys are not values: `"[[x]]": y` links nowhere.
    private func values(in node: Node) -> [Node.Scalar] {
        switch node {
        case .scalar(let scalar): [scalar]
        case .sequence(let sequence): sequence.flatMap(values(in:))
        case .mapping(let mapping): mapping.values.flatMap(values(in:))
        case .alias: []
        }
    }

    /// The wikilinks in one value, each placed at its first occurrence in
    /// the note text after the value's start — the value's own text is
    /// there verbatim unless a quoted scalar was escaped, in which case a
    /// link that cannot be found is dropped rather than misplaced.
    private func links(in scalar: Node.Scalar) -> [Wikilink] {
        guard let mark = scalar.mark, let start = offset(of: mark) else { return [] }
        var scanner = BodyScanner(scalar.string, from: 0)
        scanner.scan()
        let value = Array(scalar.string.utf8)
        var cursor = start
        var links: [Wikilink] = []
        for case .wikilink(let link) in scanner.links {
            let token = value[link.range]
            guard let range = text[cursor...].firstRange(of: token) else { continue }
            cursor = range.upperBound
            links.append(
                Wikilink(
                    target: link.target, displayText: link.displayText, range: range,
                    isFromFrontmatter: true))
        }
        return links
    }

    /// The UTF-8 offset in the note of `mark`, which counts lines from 1 and
    /// columns from 1 in Unicode scalars.
    private func offset(of mark: Mark) -> Int? {
        let line = mark.line - 1
        guard lines.indices.contains(line) else { return nil }
        let column = lines[line].unicodeScalars.prefix(mark.column - 1)
        return lineStarts[line] + String(column).utf8.count
    }
}
