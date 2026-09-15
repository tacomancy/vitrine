import Observation

/// What the Tags tab has selected: the sidebar row whose page is shown, or
/// nothing — and which tags its tree has expanded. Its own state, apart
/// from the Notes tab's scope, so the two tabs never fight (spec #72 § The
/// Tags tab); kept across tab switches, cleared with the library. Plain
/// view state, shared by the two panes because each is hosted on its own,
/// as `NotesSelection` is.
@Observable
final class TagsSelection {
    private(set) var sidebar: TagsSidebarSelection?
    /// Expanded tags, by path. The tree's own state, held here so the tag
    /// page can reveal a child it opens.
    var expandedTags: Set<String> = []

    func select(tagAt path: String) {
        sidebar = .tag(path: path)
    }

    /// A child chip on the tag page: the child's page opens, and every tag
    /// above it expands so its row is on screen in the tree.
    func reveal(tagAt path: String) {
        sidebar = .tag(path: path)
        expandedTags.formUnion(Self.ancestors(of: path))
    }

    func selectUntagged() {
        sidebar = .untagged
    }

    /// A library that has been replaced takes the selection and the
    /// expanded tags with it.
    func clear() {
        sidebar = nil
        expandedTags = []
    }

    /// The paths of the tags above `path` — `a` and `a/b` for `a/b/c` — a
    /// tag's path being its segments joined by `/` (CONTEXT.md § Tags).
    private static func ancestors(of path: String) -> [String] {
        let segments = path.split(separator: "/")
        return segments.indices.dropLast().map { segments[...$0].joined(separator: "/") }
    }
}
