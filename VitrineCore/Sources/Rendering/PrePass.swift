import Markdown
import NoteParsing

/// The body of a note prepared for cmark (ADR 0019): frontmatter cut, and
/// every wikilink, `![[embed]]`, and `#tag` rewritten over the parser's
/// ranges into standard syntax with a `vitrine:` destination. Keeps the map
/// from the rewritten text back to the original, so every block's source
/// range is in the note's own offsets.
struct PrePass {
    /// The rewritten body, what cmark parses.
    let text: String

    private let original: [UInt8]
    private let bodyStart: Int
    private let edits: [Edit]
    private let lines: LineStarts

    /// One token to rewrite: its range in the original and what replaces it.
    private struct Rewrite {
        let range: Range<Int>
        let replacement: String
    }

    /// One rewrite applied: the token's range in the original and its
    /// replacement's range in `text`.
    private struct Edit {
        let original: Range<Int>
        let rewritten: Range<Int>
    }

    init(_ parsed: ParsedNote) {
        original = Array(parsed.text.utf8)
        bodyStart = parsed.bodyRange.lowerBound
        let body = original[bodyStart...]
        let protected = PrePass.rangesCmarkReadsAsCode(in: body, from: bodyStart)
        var rewritten: [UInt8] = []
        var edits: [Edit] = []
        var copied = bodyStart
        for rewrite in PrePass.rewrites(in: parsed)
        where !protected.contains(where: { $0.overlaps(rewrite.range) }) {
            rewritten.append(contentsOf: original[copied..<rewrite.range.lowerBound])
            let start = rewritten.count
            rewritten.append(contentsOf: rewrite.replacement.utf8)
            edits.append(Edit(original: rewrite.range, rewritten: start..<rewritten.count))
            copied = rewrite.range.upperBound
        }
        rewritten.append(contentsOf: original[copied...])
        text = String(decoding: rewritten, as: UTF8.self)
        self.edits = edits
        lines = LineStarts(of: rewritten[...])
    }

    /// The tokens to rewrite, in order of appearance. Only the body's: a
    /// frontmatter link is cut with the frontmatter. A Markdown image is
    /// left for cmark, which reads it itself.
    private static func rewrites(in parsed: ParsedNote) -> [Rewrite] {
        let wikilinks = parsed.links.compactMap { link -> Rewrite? in
            guard case .wikilink(let wikilink) = link, !wikilink.isFromFrontmatter else {
                return nil
            }
            let shown = (wikilink.displayText ?? wikilink.target).escapingBrackets
            let destination = VitrineDestination.note(target: wikilink.target)
            return Rewrite(range: wikilink.range, replacement: "[\(shown)](\(destination.url))")
        }
        let embeds = parsed.embeds.compactMap { embed -> Rewrite? in
            guard isWikilinkForm(embed, in: parsed.text) else { return nil }
            let destination = VitrineDestination.attachment(
                path: embed.filename, width: embed.width)
            return Rewrite(range: embed.range, replacement: "![](\(destination.url))")
        }
        let tags = parsed.bodyTags.map { tag in
            let destination = VitrineDestination.tag(name: tag.name)
            return Rewrite(range: tag.range, replacement: "[#\(tag.name)](\(destination.url))")
        }
        return (wikilinks + embeds + tags).sorted { $0.range.lowerBound < $1.range.lowerBound }
    }

    /// Whether an embed is `![[…]]` rather than `![alt](…)`: the parser
    /// reports both alike, and only the first needs rewriting.
    private static func isWikilinkForm(_ embed: Embed, in text: String) -> Bool {
        let opening = "![[".utf8
        return text.utf8.dropFirst(embed.range.lowerBound).starts(with: opening)
    }

    /// The parser's ranges skip inline code and fences at the start of a
    /// line, but not a fence indented inside a list item or quote, indented
    /// code, or an HTML block — all code to cmark. Parsing the body as
    /// written finds them, so no token inside one is rewritten.
    private static func rangesCmarkReadsAsCode(in body: ArraySlice<UInt8>, from bodyStart: Int)
        -> [Range<Int>]
    {
        let document = Document(
            parsing: String(decoding: body, as: UTF8.self), options: [.disableSmartOpts])
        let lines = LineStarts(of: body)
        var ranges: [Range<Int>] = []
        func collect(_ markup: Markup) {
            if markup is CodeBlock || markup is HTMLBlock, let range = markup.range {
                let lower = lines.offset(of: range.lowerBound) + bodyStart
                let upper = lines.offset(of: range.upperBound) + bodyStart
                ranges.append(lower..<upper)
                return
            }
            markup.children.forEach(collect)
        }
        collect(document)
        return ranges
    }

    /// A markup node's range in the original text, trailing whitespace
    /// excluded: cmark extends a block followed by a blank line to the
    /// start of the next line, and a block's source is the text it was
    /// rendered from, not the gap after it.
    func sourceRange(of markup: Markup, within parent: Range<Int>) -> Range<Int> {
        guard let range = markup.range else { return parent }
        let lower = originalOffset(of: lines.offset(of: range.lowerBound))
        var upper = originalOffset(of: lines.offset(of: range.upperBound))
        while upper > lower, isWhitespace(original[upper - 1]) { upper -= 1 }
        return lower..<upper
    }

    /// The original offset a rewritten one came from. Inside a replacement,
    /// the corresponding offset within the token, clamped to its end.
    private func originalOffset(of rewritten: Int) -> Int {
        var shift = bodyStart
        for edit in edits {
            if rewritten <= edit.rewritten.lowerBound { break }
            if rewritten < edit.rewritten.upperBound {
                return min(
                    edit.original.lowerBound + (rewritten - edit.rewritten.lowerBound),
                    edit.original.upperBound)
            }
            shift = edit.original.upperBound - edit.rewritten.upperBound
        }
        return rewritten + shift
    }

    private func isWhitespace(_ byte: UInt8) -> Bool {
        byte == UInt8(ascii: " ") || byte == UInt8(ascii: "\t") || byte == UInt8(ascii: "\n")
            || byte == UInt8(ascii: "\r")
    }
}

/// Where each line of a text begins, so cmark's locations — lines from 1,
/// columns in UTF-8 bytes from 1 — become offsets into it.
private struct LineStarts {
    private let starts: [Int]

    /// A line ends at `\n`, or at a `\r` on its own, as cmark reads both.
    init(of bytes: ArraySlice<UInt8>) {
        var starts = [0]
        var offset = 0
        var previous: UInt8?
        for byte in bytes {
            offset += 1
            if byte == UInt8(ascii: "\n") {
                starts.append(offset)
            } else if previous == UInt8(ascii: "\r") {
                starts.append(offset - 1)
            }
            previous = byte
        }
        self.starts = starts
    }

    func offset(of location: SourceLocation) -> Int {
        starts[location.line - 1] + location.column - 1
    }
}

extension String {
    /// The text with `[` and `]` backslash-escaped, so shown text with an
    /// unbalanced bracket cannot end the link it is written into; CommonMark
    /// renders the escapes as the brackets.
    fileprivate var escapingBrackets: String {
        replacing("[", with: "\\[").replacing("]", with: "\\]")
    }
}
