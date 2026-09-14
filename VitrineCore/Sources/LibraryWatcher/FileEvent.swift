/// One file-level event the file system reported under the library root,
/// before it is read as a library change.
struct FileEvent: Equatable {
    /// The entry's path relative to the library root; empty for the root.
    let path: String
    /// Whether the entry is on disk at the moment the event was read.
    let exists: Bool
    let isFolder: Bool
    let isSymbolicLink: Bool
    /// Made by this process — Vitrine's own write, never surfaced (ADR 0014).
    let isOwn: Bool
    /// The file system lost track of what changed below a folder.
    let mustScanFolder: Bool
    let wasRenamed: Bool
    let wasModified: Bool
}
