import Library

/// One note as the Index knows it: its tags and its resolved links — none
/// of either, for a note with neither.
struct IndexedNote: Sendable {
    let note: Note
    /// Deduplicated by identity; frontmatter tags first, then the body's in
    /// order of appearance.
    let tags: [TagPath]
    /// Every link and embed in document order, frontmatter links first.
    let links: [ResolvedLink]
}
