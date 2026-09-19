/// One tag in the tag tree (CONTEXT.md § Tags), with the tags nested under it.
public struct TagTreeNode: Sendable, Equatable {
    /// The tag's last segment in its display spelling — what the sidebar shows.
    public let name: String
    /// The whole tag, lowercased — its identity, `interp/saes` for the node
    /// named `saes` under `interp`.
    public let path: String
    /// The whole tag as displayed — every segment's display spelling
    /// joined, `reading/Notes` for the node named `Notes` under `reading`
    /// (CONTEXT.md § Tags): what a filter chip shows.
    public let displaySpelling: String
    /// How many notes carry this tag or any tag under it, each note once.
    public let count: Int
    /// The tags one level down, in case-insensitive natural order by `name` —
    /// the file tree's order — and by `path` where two names order the same.
    public let children: [TagTreeNode]
}
