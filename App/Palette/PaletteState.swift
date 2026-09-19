import Observation
import Search

/// The command palette's view state (CONTEXT.md § Command palette): whether
/// it is open, the query, the results the `Search` seam answered for it,
/// and which row is highlighted. One per window, beside `NotesSelection`.
/// The query starts empty on every open; keystrokes are debounced, then
/// `Search.results(for:)` runs synchronously on the main actor (ADR 0018).
@Observable
final class PaletteState {
    private(set) var isOpen = false
    private(set) var query = ""
    /// What `Search` answered for `query`; empty while the query is.
    private(set) var results: [SearchResult] = []
    /// The index of the highlighted row in the list the palette draws;
    /// the first row on every open and every new query.
    private(set) var highlightedRow = 0

    private let currentLibrary: CurrentLibrary
    @ObservationIgnored private var pendingSearch: Task<Void, Never>?

    /// How long after the last keystroke the search runs, so typing never
    /// waits on a scan it is about to invalidate.
    static let debounce: Duration = .milliseconds(50)

    init(currentLibrary: CurrentLibrary) {
        self.currentLibrary = currentLibrary
    }

    /// ⌘K or the title-bar field: the palette opens with an empty query.
    func open() {
        query = ""
        results = []
        highlightedRow = 0
        isOpen = true
    }

    /// Esc, ⌘K while open, opening a note, or running an action.
    func close() {
        pendingSearch?.cancel()
        isOpen = false
    }

    func toggle() {
        if isOpen { close() } else { open() }
    }

    /// The query as typed; the results follow after the debounce, and
    /// the highlight returns to the first row.
    func update(query: String) {
        self.query = query
        highlightedRow = 0
        pendingSearch?.cancel()
        pendingSearch = Task {
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            runQuery()
        }
    }

    /// ⌘⌫: the query empties and the results with it.
    func clear() {
        update(query: "")
    }

    /// The results for the query as the library is now — after a save or
    /// a watcher change replaced the `Search` while the palette was open.
    func runQuery() {
        results = currentLibrary.search?.results(for: query) ?? []
    }

    /// ↑ / ↓ over the `count` rows on screen, stopping at either end.
    func moveHighlight(by offset: Int, among count: Int) {
        guard count > 0 else { return }
        highlightedRow = min(max(highlightedRow + offset, 0), count - 1)
    }

    /// The pointer over a row highlights it, as the keys do.
    func highlight(_ row: Int) {
        highlightedRow = row
    }
}
