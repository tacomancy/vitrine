import Library

/// One note with the tags it carries — none, for an untagged note.
struct NoteTags: Sendable {
    let note: Note
    /// Deduplicated by identity; frontmatter tags first, then the body's in
    /// order of appearance.
    let tags: [TagPath]
}
