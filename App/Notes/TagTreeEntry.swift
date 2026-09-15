import Index

/// One row of the TOPICS tree: a tag tree node and how deep it sits under
/// the roots.
struct TagTreeEntry: Identifiable {
    let node: TagTreeNode
    let depth: Int

    /// The tag's path — its identity.
    var id: String { node.path }
}
