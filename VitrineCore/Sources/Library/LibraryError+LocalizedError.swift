import Foundation

extension LibraryError: LocalizedError {
    /// What the app shows the user when this error surfaces — in an alert or
    /// in place of a note's body. One plain sentence or two, no error codes.
    public var errorDescription: String? {
        switch self {
        case .notAFolder: "That isn’t a folder. Vitrine opens a folder of Markdown files."
        case .unreadable: "Vitrine can’t read it. Check its permissions and try again."
        case .noteMissing: "The note is no longer where it was on disk."
        case .unwritable: "Vitrine can’t write it. Check its permissions and try again."
        case .invalidName: "A note’s title can’t be empty or contain a slash."
        case .nameTaken: "A note with that title is already in this folder."
        }
    }
}
