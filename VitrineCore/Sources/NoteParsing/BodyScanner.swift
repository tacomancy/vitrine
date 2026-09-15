import Foundation

/// A single pass over a note's body that finds tags, links, and embeds by
/// their syntax alone — no Markdown tree, just the delimiters that matter.
/// Fenced code, inline code, and HTML tags are stepped over whole.
struct BodyScanner {
    private let scalars: [Unicode.Scalar]
    /// `offsets[i]` is the UTF-8 offset of `scalars[i]`; the last entry is
    /// the offset one past the end, so every token range is a pair of these.
    private let offsets: [Int]
    private var position = 0
    /// `[[`, `]]`, and `](` are each two scalars wide.
    private let delimiterWidth = 2

    private(set) var tags: [Tag] = []
    private(set) var links: [Link] = []
    private(set) var embeds: [Embed] = []

    /// Scans `text` from UTF-8 offset `start` to its end.
    init(_ text: String, from start: Int) {
        let body = text.utf8.dropFirst(start)
        scalars = Array(String(decoding: body, as: UTF8.self).unicodeScalars)
        var offsets = [start]
        offsets.reserveCapacity(scalars.count + 1)
        for scalar in scalars {
            offsets.append(offsets[offsets.count - 1] + scalar.utf8.count)
        }
        self.offsets = offsets
    }

    mutating func scan() {
        while position < scalars.count {
            let scalar = scalars[position]
            if isAtLineStart, let fence = fenceOpening(at: position) {
                skipFencedBlock(openedBy: fence)
            } else if scalar == "`" {
                skipInlineCode()
            } else if scalar == "<", isAtHTMLTagStart {
                skipHTMLTag()
            } else if scalar == "#", isAtTagStart {
                scanTag()
            } else if scalar == "[", isNext("[") {
                scanWikilink()
            } else if scalar == "[" {
                scanMarkdownLink()
            } else {
                position += 1
            }
        }
    }

    private var isAtLineStart: Bool {
        position == 0 || scalars[position - 1] == "\n"
    }

    // MARK: - Fenced code

    private struct Fence {
        let character: Unicode.Scalar
        let length: Int
    }

    /// CommonMark: three or more backticks or tildes at the start of a line
    /// open a fenced block. Leading indentation is not honoured.
    private func fenceOpening(at index: Int) -> Fence? {
        let minimumFenceLength = 3
        guard index < scalars.count, scalars[index] == "`" || scalars[index] == "~" else {
            return nil
        }
        let character = scalars[index]
        var end = index
        while end < scalars.count, scalars[end] == character {
            end += 1
        }
        guard end - index >= minimumFenceLength else { return nil }
        return Fence(character: character, length: end - index)
    }

    /// Skips to the line after the closing fence — the same character, at
    /// least as long — or to the end of the text when the block never closes.
    private mutating func skipFencedBlock(openedBy fence: Fence) {
        skipToNextLine()
        while position < scalars.count {
            if let closing = fenceOpening(at: position), closing.character == fence.character,
                closing.length >= fence.length
            {
                skipToNextLine()
                return
            }
            skipToNextLine()
        }
    }

    private mutating func skipToNextLine() {
        while position < scalars.count, scalars[position] != "\n" {
            position += 1
        }
        position = min(position + 1, scalars.count)
    }

    // MARK: - Inline code

    /// CommonMark: a run of backticks opens a code span that the next run of
    /// exactly the same length closes; an unmatched run is literal text.
    private mutating func skipInlineCode() {
        let opening = position
        while position < scalars.count, scalars[position] == "`" {
            position += 1
        }
        let length = position - opening
        var index = position
        while index < scalars.count {
            guard scalars[index] == "`" else {
                index += 1
                continue
            }
            let runStart = index
            while index < scalars.count, scalars[index] == "`" {
                index += 1
            }
            if index - runStart == length {
                position = index
                return
            }
        }
    }

    // MARK: - HTML tags

    /// `<` opens an HTML tag when a tag name, `/`, or `!` (a comment)
    /// follows; `a < b` does not.
    private var isAtHTMLTagStart: Bool {
        guard position + 1 < scalars.count else { return false }
        let next = scalars[position + 1]
        return next.properties.isAlphabetic || next == "/" || next == "!"
    }

    /// Skips to just past the closing `>` on the same line; a `<` left open
    /// is literal text rather than a hole that swallows the rest of the note.
    private mutating func skipHTMLTag() {
        guard let closing = indexOnLine(of: ">", from: position + 1) else {
            position += 1
            return
        }
        position = closing + 1
    }

    private func isNext(_ scalar: Unicode.Scalar) -> Bool {
        position + 1 < scalars.count && scalars[position + 1] == scalar
    }

    /// An embed is a link with `!` in front: `![[image.png]]`, `![alt](file)`.
    private var isAtEmbed: Bool {
        position > 0 && scalars[position - 1] == "!"
    }

    // MARK: - Wikilinks

    /// `[[…]]` on one line; anything else is literal text. Obsidian ends the
    /// target at the first `#` (heading), `^` (block), or `|` (display text)
    /// — written `\|` inside a table cell.
    private mutating func scanWikilink() {
        let isEmbed = isAtEmbed
        let start = isEmbed ? position - 1 : position
        guard let close = indexOnLine(of: "]]", from: position + delimiterWidth) else {
            position += 1
            return
        }
        let inner = scalars[(position + delimiterWidth)..<close]
        position = close + delimiterWidth
        let range = offsets[start]..<offsets[position]
        let pipe = inner.firstIndex(of: "|")
        // Obsidian writes the pipe as `\|` inside a table cell so it does not
        // end the cell; the backslash is table escaping, not part of the target.
        let beforePipe = pipe.map { $0 > inner.startIndex && inner[$0 - 1] == "\\" ? $0 - 1 : $0 }
        if isEmbed {
            let filename = string(inner[inner.startIndex..<(beforePipe ?? inner.endIndex)])
                .trimmingCharacters(in: .whitespaces)
            guard !filename.isEmpty else { return }
            embeds.append(Embed(filename: filename, range: range))
            return
        }
        let beforeDisplayText = inner[inner.startIndex..<(beforePipe ?? inner.endIndex)]
        let targetEnd =
            beforeDisplayText.firstIndex { $0 == "#" || $0 == "^" } ?? beforeDisplayText.endIndex
        let target = string(inner[inner.startIndex..<targetEnd]).trimmingCharacters(
            in: .whitespaces)
        // `[[#Heading]]` points into this note and `[[]]` at nothing; neither
        // is a link to a note, and recording one would only read as unresolved.
        guard !target.isEmpty else { return }
        let displayText = pipe.map { string(inner[($0 + 1)...]) }
        links.append(.wikilink(Wikilink(target: target, displayText: displayText, range: range)))
    }

    // MARK: - Markdown links

    /// `[text](destination)` on one line, `(` directly after `]`; anything
    /// else is literal text and scanning resumes inside the brackets.
    private mutating func scanMarkdownLink() {
        let isEmbed = isAtEmbed
        let start = isEmbed ? position - 1 : position
        guard let textEnd = indexOnLine(of: "]", from: position + 1),
            textEnd + 1 < scalars.count, scalars[textEnd + 1] == "(",
            let destinationEnd = indexOfClosingParenthesis(from: textEnd + delimiterWidth)
        else {
            position += 1
            return
        }
        let displayText = string(scalars[(position + 1)..<textEnd])
        let rawDestination = string(scalars[(textEnd + delimiterWidth)..<destinationEnd])
        // Obsidian writes spaces in paths as %20; an undecodable destination
        // is kept as written rather than lost.
        let destination = rawDestination.removingPercentEncoding ?? rawDestination
        position = destinationEnd + 1
        let range = offsets[start]..<offsets[position]
        if isEmbed {
            embeds.append(Embed(filename: destination, range: range))
            return
        }
        links.append(
            .markdown(
                MarkdownLink(
                    destination: destination, displayText: displayText,
                    isExternal: MarkdownLink.hasURLScheme(rawDestination), range: range)))
    }

    /// CommonMark lets a destination hold balanced parentheses, as in
    /// `Paper (2019).md`, so the closing one is the first that is unmatched.
    private func indexOfClosingParenthesis(from index: Int) -> Int? {
        var depth = 0
        var index = index
        while index < scalars.count, scalars[index] != "\n" {
            switch scalars[index] {
            case "(": depth += 1
            case ")" where depth == 0: return index
            case ")": depth -= 1
            default: break
            }
            index += 1
        }
        return nil
    }

    /// The index where `delimiter` next begins on the current line, or nil.
    private func indexOnLine(of delimiter: String, from index: Int) -> Int? {
        let delimiter = Array(delimiter.unicodeScalars)
        var index = index
        while index + delimiter.count <= scalars.count, scalars[index] != "\n" {
            if scalars[index..<(index + delimiter.count)].elementsEqual(delimiter) { return index }
            index += 1
        }
        return nil
    }

    private func string(_ slice: ArraySlice<Unicode.Scalar>) -> String {
        String(String.UnicodeScalarView(slice))
    }

    // MARK: - Tags

    /// Obsidian counts `#` only at the start of a line or after whitespace,
    /// so `url/#frag` is not a tag.
    private var isAtTagStart: Bool {
        position == 0 || scalars[position - 1].properties.isWhitespace
    }

    private mutating func scanTag() {
        let start = position
        position += 1
        while position < scalars.count, TagGrammar.isTagCharacter(scalars[position]) {
            position += 1
        }
        // A trailing `-` or `/` reads as punctuation, not as part of the tag.
        var end = position
        while end > start + 1, scalars[end - 1] == "-" || scalars[end - 1] == "/" {
            end -= 1
        }
        let name = string(scalars[(start + 1)..<end])
        guard TagGrammar.isTag(name) else { return }
        tags.append(Tag(name: name, range: offsets[start]..<offsets[end]))
    }
}
