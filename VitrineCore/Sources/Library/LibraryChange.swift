/// One change another tool made to the library while it was open
/// (ADR 0014), by path relative to the library root. An entry is a folder,
/// a note, or an attachment; the coarse `folderChanged` says only that
/// something under that folder differs and it should be scanned again.
public enum LibraryChange: Sendable, Equatable {
    /// A note's contents or modification date changed.
    case noteModified(String)
    /// An attachment's contents or modification date changed.
    case attachmentModified(String)
    /// An entry appeared.
    case entryAdded(String)
    /// An entry disappeared.
    case entryRemoved(String)
    /// An entry moved from one path to another.
    case entryRenamed(from: String, to: String)
    /// Something under this folder changed; which entries is not known.
    case folderChanged(String)
}
