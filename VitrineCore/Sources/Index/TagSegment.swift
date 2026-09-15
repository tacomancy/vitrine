/// One segment of a hierarchical tag — a topic of its own (CONTEXT.md § Tags).
struct TagSegment: Hashable, Sendable {
    /// The segment lowercased: its identity.
    let identity: String
    /// The segment as the library first spelled it.
    let name: String
}
