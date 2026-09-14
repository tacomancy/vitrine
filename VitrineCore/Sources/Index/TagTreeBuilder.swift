import Foundation
import Library

/// The tag tree while notes are still being added to it: one subtree per
/// tag, with the whole forest as a nameless top. `nodes()` is the finished,
/// sorted forest.
struct TagTreeBuilder {
    /// The segment's display spelling as first seen; empty at the top,
    /// which is no tag.
    private let name: String
    /// A note tagged #a/b and #a/c is one note under `a`: a set, not a tally.
    private var carriers: Set<Note> = []
    /// Subtrees by their segment's identity.
    private var children: [String: TagTreeBuilder] = [:]

    /// An empty forest.
    init() {
        name = ""
    }

    private init(name: String) {
        self.name = name
    }

    /// Counts `note` under `tag` and under every ancestor of it, creating
    /// the nodes that do not exist yet.
    mutating func insert(_ tag: TagPath, carriedBy note: Note) {
        insert(tag.segments[...], carriedBy: note)
    }

    /// The tree as built so far, sorted at every level.
    func nodes() -> [TagTreeNode] {
        nodes(under: [])
    }

    private mutating func insert(_ segments: ArraySlice<TagSegment>, carriedBy note: Note) {
        guard let segment = segments.first else { return }
        children[segment.identity, default: TagTreeBuilder(name: segment.name)]
            .add(segments.dropFirst(), carriedBy: note)
    }

    private mutating func add(_ descendants: ArraySlice<TagSegment>, carriedBy note: Note) {
        carriers.insert(note)
        insert(descendants, carriedBy: note)
    }

    private func nodes(under ancestry: [String]) -> [TagTreeNode] {
        children.map { identity, child in
            let path = ancestry + [identity]
            return TagTreeNode(
                name: child.name,
                path: TagPath.joined(path),
                count: child.carriers.count,
                children: child.nodes(under: path))
        }
        .sorted(by: Self.isInDisplayOrder)
    }

    /// The file tree's order (CONTEXT.md § Tags): case-insensitive, with
    /// digit runs compared as numbers. Names that order the same (`01`,
    /// `1`) fall back to their paths, so the tree is deterministic.
    private static func isInDisplayOrder(_ node: TagTreeNode, _ other: TagTreeNode) -> Bool {
        switch node.name.localizedStandardCompare(other.name) {
        case .orderedAscending: true
        case .orderedDescending: false
        case .orderedSame: node.path < other.path
        }
    }
}
