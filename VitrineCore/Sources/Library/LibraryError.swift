/// What went wrong opening or reading a library, from the caller's view.
public enum LibraryError: Error, Equatable {
    /// The URL given to `Library.open(at:)` is not a folder.
    case notAFolder
    /// A folder in the library, or a note in it, exists but cannot be read.
    case unreadable
    /// The note is no longer on disk where the scan found it.
    case noteMissing
}
