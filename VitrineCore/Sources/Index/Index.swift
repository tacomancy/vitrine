import Library
import NoteParsing

/// The library's tags and links, aggregated: a value built once when a
/// library opens, in memory only, and rebuilt on every open (ADR 0012). It
/// holds nothing the library doesn't (ADR 0002).
public struct Index: Sendable {
    /// Every tag in the library arranged by hierarchy: the roots, in
    /// case-insensitive natural order by name, each with its descendants. A
    /// tag no note carries bare — `interp` when only `#interp/saes` is
    /// written — is still a node, for the tags under it.
    public let tagTree: [TagTreeNode]
    /// The notes whose text could not be read when the index was built, in
    /// library display order. Each contributes nothing: it is neither tagged
    /// nor untagged.
    public let skipped: [Note]

    /// The notes with no tag in frontmatter or body, in library display order
    /// (CONTEXT.md, Untagged).
    public var untagged: [Note] {
        notes.filter { $0.tags.isEmpty }.map(\.note)
    }

    /// Every note that was read, with its tags and links, in library
    /// display order.
    private let notes: [IndexedNote]

    /// Reads every note through `library`, parses it, aggregates its tags,
    /// and resolves its links. Never throws: a note that cannot be read
    /// lands in `skipped`.
    public static func build(from library: Library) -> Index {
        var read: [ReadNote] = []
        var skipped: [Note] = []
        for note in library.allNotes {
            guard let text = try? library.read(note) else {
                skipped.append(note)
                continue
            }
            read.append(ReadNote(note: note, text: text, parsed: ParsedNote.parse(text)))
        }
        let resolver = LinkResolver(library: library, read: read)
        var spellings = SegmentSpellings()
        var tree = TagTreeBuilder()
        var notes: [IndexedNote] = []
        for note in read {
            let tags = tags(in: note.parsed, spellings: &spellings)
            for tag in tags { tree.insert(tag, carriedBy: note.note) }
            // The parser keeps links and embeds apart; the note has them in
            // one document order, which their ranges give back.
            let links =
                (note.parsed.links.compactMap { resolver.resolve($0, from: note.note) }
                + note.parsed.embeds.compactMap { resolver.resolve($0, from: note.note) })
                .sorted { $0.range.lowerBound < $1.range.lowerBound }
            let text = Array(note.text.utf8)
            notes.append(
                IndexedNote(
                    note: note.note, tags: tags,
                    links: links.map {
                        LinkInContext(link: $0, context: ContextLine(around: $0.range, in: text))
                    }))
        }
        return Index(tagTree: tree.nodes(), skipped: skipped, notes: notes)
    }

    /// The note's tags in display spelling, deduplicated case-insensitively,
    /// frontmatter tags first and then body tags in order of appearance.
    public func tags(of note: Note) -> [String] {
        indexed(note)?.tags.map(\.displaySpelling) ?? []
    }

    /// Every link and embed in `note` in document order — the frontmatter's
    /// wikilinks first — each resolved. A self-link is here; an external
    /// link is not (CONTEXT.md § Links). A skipped note has none.
    public func links(from note: Note) -> [ResolvedLink] {
        indexed(note)?.links.map(\.link) ?? []
    }

    /// Every note that links to `note`, sorted by title — by path where two
    /// titles order the same — each with the lines around its links. A
    /// note is never its own backlink (CONTEXT.md § Links).
    public func backlinks(to note: Note) -> [Backlink] {
        notes.filter { $0.note != note }
            .compactMap { linking in
                var contexts: [ContextLine] = []
                for link in linking.links where link.link.target == .note(note) {
                    // Links come in document order, so a line's second link
                    // follows its first: one line is one context.
                    guard contexts.last?.start != link.context.start else { continue }
                    contexts.append(link.context)
                }
                guard !contexts.isEmpty else { return nil }
                return Backlink(note: linking.note, contexts: contexts.map(\.text))
            }
            .sorted(by: Self.isInTitleOrder)
    }

    /// Every unresolved target in the library, as written, with the notes
    /// that link to it in library display order, each once.
    public var unresolvedLinks: [String: [Note]] {
        var linking: [String: [Note]] = [:]
        for note in notes {
            for case .unresolved(let target) in note.links.map(\.link.target)
            where linking[target]?.last != note.note {
                linking[target, default: []].append(note.note)
            }
        }
        return linking
    }

    private func indexed(_ note: Note) -> IndexedNote? {
        notes.first { $0.note == note }
    }

    /// The file tree's order by title (CONTEXT.md, Library), falling back
    /// to the path so two notes with one title order the same every build.
    private static func isInTitleOrder(_ backlink: Backlink, _ other: Backlink) -> Bool {
        switch backlink.note.title.localizedStandardCompare(other.note.title) {
        case .orderedAscending: true
        case .orderedDescending: false
        case .orderedSame: backlink.note.path < other.note.path
        }
    }

    /// The notes carrying `tag` or any tag under it, in library display
    /// order. `tag` is a tag without its `#`, matched case-insensitively; a
    /// tag no note carries yields none.
    public func notes(tagged tag: String) -> [Note] {
        let ancestry = TagPath.segmentIdentities(of: tag)
        return notes.filter { $0.tags.contains { $0.isCounted(under: ancestry) } }.map(\.note)
    }

    /// A parsed note's tags: frontmatter first, then the body in order of
    /// appearance, each identity once — the parser leaves repeats in.
    private static func tags(in parsed: ParsedNote, spellings: inout SegmentSpellings)
        -> [TagPath]
    {
        let written = (parsed.frontmatter?.tags ?? []) + parsed.bodyTags.map(\.name)
        var tags: [TagPath] = []
        for spelling in written {
            guard let tag = TagPath(spelling, spellings: &spellings) else { continue }
            if !tags.contains(tag) { tags.append(tag) }
        }
        return tags
    }
}
