import Index

extension [TagTreeNode] {
    /// The nodes from a root down to the tag at `path` — `a`, `a/b`, `a/b/c`
    /// for `a/b/c` — or `nil` when no tag in this tree has that path. Their
    /// names joined by `/` are the tag's display spelling (CONTEXT.md
    /// § Tags).
    func ancestry(of path: String) -> [TagTreeNode]? {
        var ancestry: [TagTreeNode] = []
        var children = self
        for segment in path.split(separator: "/") {
            let prefix = ancestry.last.map { $0.path + "/" + segment } ?? String(segment)
            guard let node = children.first(where: { $0.path == prefix }) else { return nil }
            ancestry.append(node)
            children = node.children
        }
        return ancestry.isEmpty ? nil : ancestry
    }
}
