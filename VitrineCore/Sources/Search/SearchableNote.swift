import Library
import NoteParsing

/// One note as search holds it: the note and its parse — the original
/// title, aliases, and text — beside their folded copies, so a query is
/// matched against the folded ones and its matches shown in the
/// originals.
struct SearchableNote: Sendable {
    let note: Note
    let parsed: ParsedNote
    private let foldedTitle: [UInt8]
    private let foldedAliases: [[UInt8]]
    private let foldedText: [UInt8]

    init(note: Note, parsed: ParsedNote) {
        self.note = note
        self.parsed = parsed
        foldedTitle = TextFolding.fold(note.title)
        foldedAliases = (parsed.frontmatter?.aliases ?? []).map(TextFolding.fold)
        foldedText = TextFolding.fold(parsed.text)
    }

    /// Whether every term occurs somewhere in the title, an alias, or the
    /// text (CONTEXT.md § Search).
    func matches(_ terms: [[UInt8]]) -> Bool {
        terms.allSatisfy { term in
            foldedTitle.firstOccurrence(of: term) != nil
                || foldedText.firstOccurrence(of: term) != nil
                || foldedAliases.contains { $0.firstOccurrence(of: term) != nil }
        }
    }

    /// Whether the title, or one alias, contains every term: what puts a
    /// note in the first group of results (ADR 0018).
    func matchesInTitle(_ terms: [[UInt8]]) -> Bool {
        ([foldedTitle] + foldedAliases).contains { name in
            terms.allSatisfy { name.firstOccurrence(of: $0) != nil }
        }
    }

    /// Every term occurrence in the original title, for the wash — whether
    /// or not the match was there.
    func titleRanges(for terms: [[UInt8]]) -> [Range<Int>] {
        TextFolding.ranges(of: terms, in: note.title)
    }

    /// The first line of the text containing any term, with every term
    /// occurrence on it; the first non-empty line, with none, when no term
    /// is in the text at all.
    func excerpt(for terms: [[UInt8]]) -> Excerpt {
        let newline = UInt8(ascii: "\n")
        let lines = parsed.text.utf8.split(separator: newline, omittingEmptySubsequences: false)
            .map(Self.withoutLineEnding)
        // A term holds no whitespace, so no match spans a line break, and
        // folding keeps every line break: the folded text's line is the
        // original's.
        guard let first = terms.compactMap({ foldedText.firstOccurrence(of: $0)?.lowerBound }).min()
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
