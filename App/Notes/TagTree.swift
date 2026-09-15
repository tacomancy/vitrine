import Index
import SwiftUI

/// The TOPICS tree: the library's tags by hierarchy, in the order the `Index`
/// seam gives, each with its count. Nodes with children expand and collapse;
/// every node selects.
struct TagTree: View {
    let roots: [TagTreeNode]
    let selection: NotesSelection
    /// Expanded tags, by path.
    @Binding var expandedTags: Set<String>

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(visibleEntries) { entry in
                row(for: entry)
            }
        }
    }

    private func row(for entry: TagTreeEntry) -> some View {
        let node = entry.node
        let isExpanded = expandedTags.contains(node.path)
        return SidebarRow(
            glyph: "number", name: node.name, count: node.count, depth: entry.depth,
            disclosure: disclosure(of: node, isExpanded: isExpanded),
            emphasis: selection.sidebar == .tag(path: node.path) ? .selected : .normal
        ) {
            // As the file tree's folders: one click selects the tag as the
            // scope and, when it has children, toggles them.
            selection.select(tagAt: node.path)
            guard !node.children.isEmpty else { return }
            if isExpanded {
                expandedTags.remove(node.path)
            } else {
                expandedTags.insert(node.path)
            }
        }
    }

    private func disclosure(of node: TagTreeNode, isExpanded: Bool) -> SidebarRow.Disclosure {
        if node.children.isEmpty { return .none }
        return isExpanded ? .expanded : .collapsed
    }

    /// The tree flattened to what is on screen: the roots and, after each
    /// expanded node, its children, recursively — in tag tree order.
    private var visibleEntries: [TagTreeEntry] {
        entries(of: roots, depth: 0)
    }

    private func entries(of nodes: [TagTreeNode], depth: Int) -> [TagTreeEntry] {
        var entries: [TagTreeEntry] = []
        for node in nodes {
            entries.append(TagTreeEntry(node: node, depth: depth))
            if expandedTags.contains(node.path) {
                entries += self.entries(of: node.children, depth: depth + 1)
            }
        }
        return entries
    }
}
