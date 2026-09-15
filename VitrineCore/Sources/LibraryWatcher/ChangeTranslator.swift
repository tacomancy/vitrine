import Library

/// Reads a batch of file events as library changes, remembering which
/// entries the library holds so an event's flags never have the last word:
/// the file system marks a file *created* for a while after it appears, so
/// a later edit to it would otherwise read as a second addition.
///
/// A class because that memory is shared across a watch's batches — which
/// arrive one at a time, on the stream's own queue, so it is never reached
/// concurrently; hence unchecked.
final class ChangeTranslator: @unchecked Sendable {
    /// Every entry known to be in the library, by path; the root is `""`.
    private var knownPaths: Set<String>

    init(_ library: Library) {
        knownPaths = Self.paths(under: library.root)
        knownPaths.insert("")
    }

    /// The changes one batch of events amounts to, each path once, in the
    /// order the events came. The two halves of a rename are one change
    /// when the batch holds exactly one known entry departing and one
    /// unknown arriving; any other arrival at a known path is a
    /// modification — an editor that saves by writing a sibling and
    /// renaming it over the note has modified the note, not renamed it.
    func changes(for events: [FileEvent]) -> [LibraryChange] {
        var changes: [LibraryChange] = []
        var departed: [String] = []
        var arrived: [String] = []
        for event in events where event.isVisible {
            if event.mustScanFolder {
                changes.append(.folderChanged(event.path))
            } else if event.wasRenamed {
                if event.exists { arrived.append(event.path) } else { departed.append(event.path) }
            } else if let change = change(for: event) {
                changes.append(change)
            }
        }
        departed = departed.filter(knownPaths.contains)
        if departed.count == 1, arrived.count == 1, !knownPaths.contains(arrived[0]) {
            changes.append(.entryRenamed(from: departed[0], to: arrived[0]))
        } else {
            changes += departed.map(LibraryChange.entryRemoved)
            changes += arrived.map { knownPaths.contains($0) ? modified($0) : .entryAdded($0) }
        }
        let distinct = changes.reduce(into: [LibraryChange]()) { distinct, change in
            if !distinct.contains(change) { distinct.append(change) }
        }
        for change in distinct { remember(change) }
        return distinct
    }

    private func change(for event: FileEvent) -> LibraryChange? {
        let isKnown = knownPaths.contains(event.path)
        guard event.exists else { return isKnown ? .entryRemoved(event.path) : nil }
        guard isKnown else { return .entryAdded(event.path) }
        // A folder's own modification is its entries coming and going, and
        // those arrive as events of their own.
        guard event.wasModified, !event.isFolder else { return nil }
        return modified(event.path)
    }

    private func modified(_ path: String) -> LibraryChange {
        Library.isNote(path) ? .noteModified(path) : .attachmentModified(path)
    }

    private func remember(_ change: LibraryChange) {
        switch change {
        case .entryAdded(let path):
            knownPaths.insert(path)
        case .entryRemoved(let path):
            forget(path)
        case .entryRenamed(let from, let to):
            forget(from)
            knownPaths.insert(to)
        case .noteModified, .attachmentModified, .folderChanged:
            break
        }
    }

    /// Forgets the entry at `path` and, if it was a folder, everything in it.
    private func forget(_ path: String) {
        knownPaths = knownPaths.filter { $0 != path && !$0.hasPrefix(path + "/") }
    }

    private static func paths(under folder: Folder) -> Set<String> {
        var paths: Set<String> = [folder.path]
        paths.formUnion(folder.notes.map(\.path))
        paths.formUnion(folder.attachments.map(\.path))
        for child in folder.folders { paths.formUnion(Self.paths(under: child)) }
        return paths
    }
}
