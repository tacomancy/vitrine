/// What the Tags tab's sidebar has selected — the tag page's subject
/// (CONTEXT.md § Tag page): one tag by its path, or Untagged.
enum TagsSidebarSelection: Equatable {
    case tag(path: String)
    case untagged
}
