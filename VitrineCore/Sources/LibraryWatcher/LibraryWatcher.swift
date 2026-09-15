import Library

/// Watches an open library for changes made by any other tool (ADR 0014):
/// Obsidian, Finder, a sync client. Vitrine's own writes never surface, and
/// neither does anything the scan rules would skip.
public enum LibraryWatcher {
    /// Every change another tool makes under the library's root, from now
    /// until the task consuming the stream is cancelled. Rapid changes to
    /// one entry arrive as one change.
    public static func watch(_ library: Library) -> AsyncStream<LibraryChange> {
        AsyncStream { continuation in
            let translator = ChangeTranslator(library)
            let events = FileEventStream(root: library.rootURL) { batch in
                for change in translator.changes(for: batch) { continuation.yield(change) }
            }
            continuation.onTermination = { _ in events.stop() }
            events.start()
        }
    }
}
