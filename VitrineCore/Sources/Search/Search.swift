import Index
import Library
import NoteParsing

/// Full-text search over a library (CONTEXT.md § Search): a value built
/// from the texts the Index already caches, with a folded copy of every
/// note's title, aliases, and text, scanned in full for each query
/// (ADR 0018). Nothing is on disk, and nothing here can fail.
public struct Search: Sendable {
    /// Every read note, in library display order.
    private let notes: [SearchableNote]

    /// Folds every note the Index read — its title, aliases, and full
    /// text, frontmatter included. A note in `Index.skipped` is absent.
    public static func build(from index: Index) -> Search {
        Search(notes: index.parsedNotes.map(SearchableNote.init))
    }

    /// The notes matching `query`, ranked (CONTEXT.md § Search): the query
    /// splits on whitespace into terms; a note matches when every term is
    /// a substring — case and diacritics ignored — of its title, an alias,
    /// or its text. Notes whose title or one alias holds every term come
    /// first, then the rest, each group newest-modified first and ties in
    /// library display order. An empty or whitespace-only query matches
    /// nothing.
    public func results(for query: String) -> [SearchResult] {
        let terms = Self.terms(in: query)
        guard !terms.isEmpty else { return [] }
        return notes.filter { $0.matches(terms) }.map { note in
            SearchResult(
                note: note.note,
                matchedInTitle: note.matchesInTitle(terms),
                titleRanges: TextFolding.ranges(of: terms, in: note.note.title),
                excerpt: note.excerpt(for: terms))
        }
    }

    /// The query's terms, folded, each once.
    private static func terms(in query: String) -> [[UInt8]] {
        var terms: [[UInt8]] = []
        for word in query.split(whereSeparator: \.isWhitespace) {
            let term = TextFolding.fold(String(word))
            if !terms.contains(term) { terms.append(term) }
        }
        return terms
    }
}
