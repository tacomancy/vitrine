import Foundation
import Index
import Library
import Observation

/// The one library open in the window (ADR 0007), its Index, and the rule
/// for opening another: a successful open replaces both and remembers the
/// path; a failed open changes nothing. No library is First run.
@Observable
final class CurrentLibrary {
    private(set) var library: Library?
    /// The open library's Index, built with it; `nil` exactly when `library` is.
    private(set) var index: Index?
    /// Why the last open from the panel failed; cleared when the alert closes.
    var openFailure: LibraryError?

    // App-level user defaults: nothing is written into the library and no
    // sidecar is created (ADR 0002).
    private static let lastLibraryPathKey = "lastLibraryPath"

    /// At launch, the last library reopens. One that has gone or cannot be
    /// read leaves First run showing, silently: a missing folder is not a
    /// fault, and its path stays remembered in case it comes back.
    func reopenLast() {
        guard let path = UserDefaults.standard.string(forKey: Self.lastLibraryPathKey),
            let library = try? Library.open(at: URL(filePath: path))
        else { return }
        replace(with: library)
    }

    /// Opens the folder as the library. On success it replaces the current
    /// one and its path is remembered; on failure `openFailure` carries the
    /// reason and neither the library nor the remembered path changes.
    func open(folderAt url: URL) {
        do {
            replace(with: try Library.open(at: url))
            UserDefaults.standard.set(
                url.path(percentEncoded: false), forKey: Self.lastLibraryPathKey)
        } catch {
            openFailure = error
        }
    }

    // ADR 0012: the Index is built here, synchronously, so a library is never
    // on screen without its tags — no loading state.
    private func replace(with library: Library) {
        index = Index.build(from: library)
        self.library = library
    }
}
