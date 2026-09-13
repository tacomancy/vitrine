import Foundation
import Library
import Observation

/// The one library open in the window (ADR 0007) and the rule for opening
/// another: a successful open replaces it and remembers its path; a failed
/// open changes nothing. No library is First run.
@Observable
final class CurrentLibrary {
    private(set) var library: Library?
    /// Why the last open from the panel failed; cleared when the alert closes.
    var openFailure: LibraryError?

    // App-level user defaults: nothing is written into the library and no
    // sidecar is created (ADR 0002).
    private static let lastLibraryPathKey = "lastLibraryPath"

    /// At launch, the last library reopens. One that has gone or cannot be
    /// read leaves First run showing, silently: a missing folder is not a
    /// fault, and its path stays remembered in case it comes back.
    func reopenLast() {
        guard let path = UserDefaults.standard.string(forKey: Self.lastLibraryPathKey) else {
            return
        }
        library = try? Library.open(at: URL(filePath: path))
    }

    /// Opens the folder as the library. On success it replaces the current
    /// one and its path is remembered; on failure `openFailure` carries the
    /// reason and neither the library nor the remembered path changes.
    func open(folderAt url: URL) {
        do {
            library = try Library.open(at: url)
            UserDefaults.standard.set(
                url.path(percentEncoded: false), forKey: Self.lastLibraryPathKey)
        } catch {
            openFailure = error
        }
    }
}
