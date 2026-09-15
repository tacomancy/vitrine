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

extension FileEvent {
    /// Whether the library would see this entry at all: not Vitrine's own
    /// doing, not a dot-entry at any depth (`.obsidian/` churn is invisible),
    /// and not a symbolic link — the scan rules, applied to events
    /// (CONTEXT.md § The library).
    var isVisible: Bool {
        !isOwn && isInLibrary
    }

    /// Whether the entry is one the library holds, whoever changed it: not
    /// a dot-entry at any depth and not a symbolic link.
    var isInLibrary: Bool {
        !isSymbolicLink && !path.split(separator: "/").contains { $0.hasPrefix(".") }
    }
}
