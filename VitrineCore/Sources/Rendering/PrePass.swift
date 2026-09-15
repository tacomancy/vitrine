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
    private let lineStarts: [Int]

    /// One rewrite: the token's range in the original and its replacement's
    /// range in `text`.
    private struct Edit {
        let original: Range<Int>
        let rewritten: Range<Int>
    }

    init(_ parsed: ParsedNote) {
        original = Array(parsed.text.utf8)
        bodyStart = parsed.bodyRange.lowerBound
        var rewritten: [UInt8] = []
        var edits: [Edit] = []
        var copied = bodyStart
        for (range, replacement) in PrePass.rewrites(in: parsed) {
            rewritten.append(contentsOf: original[copied..<range.lowerBound])
            let start = rewritten.count
            rewritten.append(contentsOf: replacement.utf8)
            edits.append(Edit(original: range, rewritten: start..<rewritten.count))
            copied = range.upperBound
        }
        rewritten.append(contentsOf: original[copied...])
        text = String(decoding: rewritten, as: UTF8.self)
        self.edits = edits
        lineStarts = PrePass.lineStarts(of: rewritten)
    }

    /// The tokens to rewrite, in order of appearance, each with its
    /// replacement. Only the body's: a frontmatter link is cut with the
    /// frontmatter.
    private static func rewrites(in parsed: ParsedNote) -> [(Range<Int>, String)] {
        let wikilinks = parsed.links.compactMap { link -> (Range<Int>, String)? in
            guard case .wikilink(let wikilink) = link, !wikilink.isFromFrontmatter else {
                return nil
            }
            let shown = wikilink.displayText ?? wikilink.target
            return (
                wikilink.range,
                "[\(shown)](\(VitrineDestination.note(target: wikilink.target).url))"
            )
        }
        let embeds = parsed.embeds.compactMap { embed -> (Range<Int>, String)? in
            guard let width = embedWidth(of: embed, in: parsed.text) else { return nil }
            let destination = VitrineDestination.attachment(path: embed.filename, width: width)
            return (embed.range, "![](\(destination.url))")
        }
        let tags = parsed.bodyTags.map { tag in
            (tag.range, "[#\(tag.name)](\(VitrineDestination.tag(name: tag.name).url))")
        }
        return (wikilinks + embeds + tags).sorted { $0.0.lowerBound < $1.0.lowerBound }
    }

    /// The width of an `![[image.png|800]]` embed, or nil for a Markdown
    /// image, which cmark reads itself. The parser drops the suffix, so it
    /// is read again from the token: digits after the last `|`, as
    /// Obsidian writes a display width. An embed without one is `.some(nil)`.
    private static func embedWidth(of embed: Embed, in text: String) -> Int?? {
        let token = String(decoding: Array(text.utf8)[embed.range], as: UTF8.self)
        guard token.hasPrefix("![[") else { return nil }
        guard let pipe = token.lastIndex(of: "|") else { return .some(nil) }
        let suffix = token[token.index(after: pipe)...].dropLast(2)
        return .some(Int(suffix))
    }

    /// Where a line begins in the rewritten text, one entry per line; cmark
    /// counts lines from 1 and columns in UTF-8 bytes from 1.
    private static func lineStarts(of bytes: [UInt8]) -> [Int] {
        var starts = [0]
        for (offset, byte) in bytes.enumerated() {
            if byte == UInt8(ascii: "\n")
                || (byte == UInt8(ascii: "\r")
                    && bytes[safe: offset + 1] != UInt8(ascii: "\n"))
            {
                starts.append(offset + 1)
            }
        }
        return starts
    }

    /// A markup node's range in the original text, trailing whitespace
    /// excluded: cmark extends a block followed by a blank line to the
    /// start of the next line, and a block's source is the text it was
    /// rendered from, not the gap after it.
    func sourceRange(of markup: Markup, within parent: Range<Int>) -> Range<Int> {
        guard let range = markup.range else { return parent }
        let lower = originalOffset(of: offset(of: range.lowerBound))
        var upper = originalOffset(of: offset(of: range.upperBound))
        while upper > lower, isWhitespace(original[upper - 1]) { upper -= 1 }
        return lower..<upper
    }

    /// A location in the rewritten text as a UTF-8 offset into it.
    private func offset(of location: SourceLocation) -> Int {
        lineStarts[location.line - 1] + location.column - 1
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

extension Array {
    fileprivate subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
