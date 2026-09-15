import Library

/// One note as the Index knows it: its tags and its resolved links — none
/// of either, for a note with neither.
struct IndexedNote: Sendable {
    let note: Note
    /// Deduplicated by identity; frontmatter tags first, then the body's in
    /// order of appearance.
    let tags: [TagPath]
    /// Every link and embed in document order, frontmatter links first,
    /// each with its line.
    let links: [LinkInContext]

    /// Whether this note is counted under the tag whose segment identities
    /// are `ancestry`: it carries that tag or one under it (CONTEXT.md
    /// § Tags).
    func isTagged(under ancestry: [String]) -> Bool {
        tags.contains { $0.isCounted(under: ancestry) }
    }
}
