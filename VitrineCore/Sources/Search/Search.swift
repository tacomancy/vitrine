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

    /// This search with `note` — as the library holds it now — folded from
    /// `parsed` instead; a note the search has never held is added, as
    /// `adding` would.
    public func updating(_ note: Note, parsed: ParsedNote) -> Search {
        guard let index = notes.firstIndex(where: { $0.note.path == note.path }) else {
            return adding(note, parsed: parsed)
        }
        var notes = notes
        notes[index] = SearchableNote(note: note, parsed: parsed)
        return Search(notes: notes)
    }

    /// This search with `note`, folded from `parsed`, in its place in
    /// library display order; a note already at its path is replaced.
    public func adding(_ note: Note, parsed: ParsedNote) -> Search {
        var notes = removing(note).notes
        let index =
            notes.firstIndex { LibraryDisplayOrder.precedes(note.path, $0.note.path) }
            ?? notes.count
        notes.insert(SearchableNote(note: note, parsed: parsed), at: index)
        return Search(notes: notes)
    }

    /// This search without the note at `note`'s path; a note the search
    /// does not hold changes nothing.
    public func removing(_ note: Note) -> Search {
        Search(notes: notes.filter { $0.note.path != note.path })
    }

    /// This search with `note` known as `renamed` — its text kept, its
    /// title and place in library display order taken afresh. A note the
    /// search does not hold changes nothing.
    public func renaming(_ note: Note, to renamed: Note) -> Search {
        guard let held = notes.first(where: { $0.note.path == note.path }) else { return self }
        return removing(note).adding(renamed, parsed: held.parsed)
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
        return notes.filter { $0.matches(terms) }
            .map { note in
                SearchResult(
                    note: note.note,
                    matchedInTitle: note.matchesInTitle(terms),
                    titleRanges: TextFolding.ranges(of: terms, in: note.note.title),
                    excerpt: note.excerpt(for: terms))
            }
            .enumerated()
            .sorted(by: Self.isInRankOrder)
            .map(\.element)
    }

    /// ADR 0018's ranking. The offset is the note's place in library
    /// display order, which breaks ties, so the sort need not be stable.
    private static func isInRankOrder(
        _ result: (offset: Int, element: SearchResult),
        _ other: (offset: Int, element: SearchResult)
    ) -> Bool {
        guard result.element.matchedInTitle == other.element.matchedInTitle else {
            return result.element.matchedInTitle
        }
        guard result.element.note.modifiedAt == other.element.note.modifiedAt else {
            return result.element.note.modifiedAt > other.element.note.modifiedAt
        }
        return result.offset < other.offset
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
