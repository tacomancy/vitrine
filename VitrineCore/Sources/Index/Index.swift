import Library
import NoteParsing

/// The library's tags, aggregated: a value built once when a library opens,
/// in memory only, and rebuilt on every open (ADR 0012). It holds nothing
/// the library doesn't (ADR 0002), and nothing about links or embeds until
/// the spec that needs them (ADR 0003).
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
        noteTags.filter { $0.tags.isEmpty }.map(\.note)
    }

    /// Every note that was read, with its tags, in library display order.
    private let noteTags: [NoteTags]

    /// Reads every note through `library`, parses it, and aggregates its
    /// tags. Never throws: a note that cannot be read lands in `skipped`.
    public static func build(from library: Library) -> Index {
        var spellings = SegmentSpellings()
        var tree = TagTreeBuilder()
        var noteTags: [NoteTags] = []
        var skipped: [Note] = []
        for note in library.allNotes {
            guard let text = try? library.read(note) else {
                skipped.append(note)
                continue
            }
            let tags = tags(in: ParsedNote.parse(text), spellings: &spellings)
            for tag in tags { tree.insert(tag, carriedBy: note) }
            noteTags.append(NoteTags(note: note, tags: tags))
        }
        return Index(tagTree: tree.nodes(), skipped: skipped, noteTags: noteTags)
    }

    /// The note's tags in display spelling, deduplicated case-insensitively,
    /// frontmatter tags first and then body tags in order of appearance.
    public func tags(of note: Note) -> [String] {
        noteTags.first { $0.note == note }?.tags.map(\.displaySpelling) ?? []
    }

    /// The notes carrying `tag` or any tag under it, in library display
    /// order. `tag` is a tag without its `#`, matched case-insensitively; a
    /// tag no note carries yields none.
    public func notes(tagged tag: String) -> [Note] {
        let ancestry = TagPath.segmentIdentities(of: tag)
        return noteTags.filter { $0.tags.contains { $0.isCounted(under: ancestry) } }.map(\.note)
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
