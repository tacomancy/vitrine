import Library

/// One note that links to another, from the target's point of view
/// (CONTEXT.md, Backlink).
public struct Backlink: Sendable, Equatable {
    /// The linking note.
    public let note: Note
    /// The line around each link into the target, in document order — one
    /// per line, so a line that links twice is one context; a frontmatter
    /// link's is its property line.
    public let contexts: [String]

    /// Memberwise, so a test's expected value can build one directly.
    public init(note: Note, contexts: [String]) {
        self.note = note
        self.contexts = contexts
    }
}
