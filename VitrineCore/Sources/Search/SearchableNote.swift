import Library
import NoteParsing

/// One note as search holds it: the original title, aliases, and text
/// beside their folded copies, so a query is matched against the folded
/// ones and its matches shown in the originals.
struct SearchableNote: Sendable {
    let note: Note
    let aliases: [String]
    let text: String
    let foldedTitle: [UInt8]
    let foldedAliases: [[UInt8]]
    let foldedText: [UInt8]

    init(note: Note, parsed: ParsedNote) {
        self.note = note
        aliases = parsed.frontmatter?.aliases ?? []
        text = parsed.text
        foldedTitle = TextFolding.fold(note.title)
        foldedAliases = aliases.map(TextFolding.fold)
        foldedText = TextFolding.fold(parsed.text)
    }

    /// Whether every term occurs somewhere in the title, an alias, or the
    /// text (CONTEXT.md § Search).
    func matches(_ terms: [[UInt8]]) -> Bool {
        terms.allSatisfy { term in
            foldedTitle.contains(term) || foldedText.contains(term)
                || foldedAliases.contains { $0.contains(term) }
        }
    }

    /// Whether the title, or one alias, contains every term: what puts a
    /// note in the first group of results (ADR 0018).
    func matchesInTitle(_ terms: [[UInt8]]) -> Bool {
        ([foldedTitle] + foldedAliases).contains { name in
            terms.allSatisfy { name.contains($0) }
        }
    }

    /// The first line of the text containing any term, with every term
    /// occurrence on it; the first non-empty line, with none, when no term
    /// is in the text at all.
    func excerpt(for terms: [[UInt8]]) -> Excerpt {
        let newline = UInt8(ascii: "\n")
        let lines = text.utf8.split(separator: newline, omittingEmptySubsequences: false)
            .map(Self.withoutLineEnding)
        // A term holds no whitespace, so no match spans a line break, and
        // folding keeps every line break: the folded text's line is the
        // original's.
        guard let first = terms.compactMap({ foldedText.firstRange(of: $0)?.lowerBound }).min()
        else {
            return Excerpt(text: lines.first { !$0.isEmpty } ?? "", ranges: [])
        }
        let line = lines[foldedText[..<first].count(where: { $0 == newline })]
        return Excerpt(text: line, ranges: TextFolding.ranges(of: terms, in: line))
    }

    /// A Windows line ending leaves its `\r` before the `\n` a line was
    /// split on.
    private static func withoutLineEnding(_ line: Substring.UTF8View) -> String {
        String(decoding: line.last == UInt8(ascii: "\r") ? line.dropLast() : line, as: UTF8.self)
    }
}
