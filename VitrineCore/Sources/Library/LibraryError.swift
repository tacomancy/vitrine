/// What went wrong opening, reading, or writing a library, from the caller's
/// view.
public enum LibraryError: Error, Equatable {
    /// The URL given to `Library.open(at:)` is not a folder.
    case notAFolder
    /// A folder in the library, or a note in it, exists but cannot be read.
    case unreadable
    /// The note is no longer on disk where the scan found it.
    case noteMissing
    /// The note, or the folder a note would go in, cannot be written.
    case unwritable
    /// The title given for a note is empty or contains a path separator.
    case invalidName
    /// Another note in the same folder already has that title.
    case nameTaken
}
