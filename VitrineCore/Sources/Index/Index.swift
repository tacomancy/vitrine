import Library
import NoteParsing

/// The library's tags and links, aggregated: a value built once when a
/// library opens, in memory only, and rebuilt on every open (ADR 0012). It
/// holds nothing the library doesn't (ADR 0002). Between opens it keeps
/// each note's parse, so one note's change is folded in without reading
/// or parsing any other (ADR 0017): `updating`, `adding`, `removing`, and
/// `renaming` each answer with a new Index whose every table is recomputed.
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
    /// What every table above was computed from, kept for the next change.
    private let parsedLibrary: ParsedLibrary
    /// The link rules over this library, kept for a link the tables have
    /// not seen: one the editor has just parsed out of unsaved text.
    private let resolver: LinkResolver

    /// Reads every note through `library`, parses it, aggregates its tags,
    /// and resolves its links. Never throws: a note that cannot be read
    /// lands in `skipped`.
    public static func build(from library: Library) -> Index {
        Index(ParsedLibrary(reading: library))
    }

    /// This index with `note` — as the library holds it now — read as
    /// `parsed` instead: its tags, links, and backlinks on other notes
    /// follow, and nothing on disk is touched. A skipped note gains its
    /// parse and is skipped no more; a note the index has never held is
    /// added, as `adding` would.
    public func updating(_ note: Note, parsed: ParsedNote) -> Index {
        var parsedLibrary = parsedLibrary
        parsedLibrary.update(note, parsed: parsed)
        return Index(parsedLibrary)
    }

    /// This index with `note`, read as `parsed`, placed in library display
    /// order: links elsewhere that its title, alias, or path now satisfies
    /// resolve to it, and nothing on disk is touched.
    public func adding(_ note: Note, parsed: ParsedNote) -> Index {
        var parsedLibrary = parsedLibrary
        parsedLibrary.add(note, parsed: parsed)
        return Index(parsedLibrary)
    }

    /// This index without `note`: its tags leave the tree, links to it
    /// become unresolved, and nothing on disk is touched. A note the index
    /// does not hold changes nothing.
    public func removing(_ note: Note) -> Index {
        var parsedLibrary = parsedLibrary
        parsedLibrary.remove(note)
        return Index(parsedLibrary)
    }

    /// This index with `note` known as `renamed` — its parse kept, its
    /// place in library display order taken afresh — so links by the old
    /// title come loose and links by the new one land, without touching
    /// the disk. A note whose text was never read stays unread — skipped —
    /// under its new path.
    public func renaming(_ note: Note, to renamed: Note) -> Index {
        var parsedLibrary = parsedLibrary
        parsedLibrary.rename(note, to: renamed)
        return Index(parsedLibrary)
    }

    /// Every table, computed from `parsedLibrary` alone.
    private init(_ parsedLibrary: ParsedLibrary) {
        let resolver = LinkResolver(parsedLibrary)
        var spellings = SegmentSpellings()
        var tree = TagTreeBuilder()
        var notes: [IndexedNote] = []
        for (note, parsed) in parsedLibrary.parsed {
            let tags = Self.tags(in: parsed, spellings: &spellings)
            for tag in tags { tree.insert(tag, carriedBy: note) }
            notes.append(
                IndexedNote(
                    note: note, tags: tags,
                    links: Self.links(in: parsed, of: note, resolver: resolver)))
        }
        tagTree = tree.nodes()
        skipped = parsedLibrary.skipped
        self.notes = notes
        self.parsedLibrary = parsedLibrary
        self.resolver = resolver
    }

    /// A note's links and embeds resolved, in one document order — the
    /// parser keeps the two apart; their ranges put them back — each with
    /// the line it sits on.
    private static func links(in parsed: ParsedNote, of note: Note, resolver: LinkResolver)
        -> [LinkInContext]
    {
        let text = Array(parsed.text.utf8)
        let links =
            parsed.links.compactMap { resolver.resolve($0, from: note) }
            + parsed.embeds.compactMap { resolver.resolve($0, from: note) }
        return
            links
            .sorted { $0.range.lowerBound < $1.range.lowerBound }
            .map { LinkInContext(link: $0, context: ContextLine(around: $0.range, in: text)) }
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

    /// `link`, as written in `note`, resolved by the same rules as
    /// `links(from:)` — for a link parsed out of text the Index has not
    /// been given, such as the editor's unsaved buffer; the tables are not
    /// consulted for `note` itself and nothing changes. Nil for an external
    /// link (CONTEXT.md § Links).
    public func resolve(_ link: Link, from note: Note) -> ResolvedLink? {
        resolver.resolve(link, from: note)
    }

    /// `embed`, as written in `note`, resolved as `links(from:)` would; nil
    /// for an embed of a URL.
    public func resolve(_ embed: Embed, from note: Note) -> ResolvedLink? {
        resolver.resolve(embed, from: note)
    }

    /// Every note that links to `note`, sorted by title — by path where two
    /// titles order the same — each with the lines around its links. A
    /// note is never its own backlink (CONTEXT.md § Links).
    public func backlinks(to note: Note) -> [Backlink] {
        notes.filter { $0.note != note }
            .compactMap { linking in
                let contexts = Self.contexts(of: linking.links, into: note)
                guard !contexts.isEmpty else { return nil }
                return Backlink(note: linking.note, contexts: contexts)
            }
            .sorted(by: Self.isInTitleOrder)
    }

    /// The lines of `links` that point at `target`, each line once
    /// (ADR 0016). Links come in document order, so a line's second link
    /// follows its first.
    private static func contexts(of links: [LinkInContext], into target: Note) -> [String] {
        var contexts: [ContextLine] = []
        for link in links where link.link.target == .note(target) {
            guard contexts.last?.start != link.context.start else { continue }
            contexts.append(link.context)
        }
        return contexts.map(\.text)
    }

    /// Every unresolved target in the library — a wikilink's target, or a
    /// Markdown link's percent-decoded destination — with the notes that
    /// link to it in library display order, each once.
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
