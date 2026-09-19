/// One of the app's commands as the command palette lists it under ACTIONS
/// (CONTEXT.md § Command palette): what the row says, and nothing about
/// how it runs — the palette runs it.
enum PaletteAction: Equatable {
    /// ⌘N's note: `Untitled` in the sidebar's folder, its title focused.
    case newUntitledNote
    /// A note titled by the query, in the sidebar's folder — offered only
    /// while no note's title is the query already.
    case newNote(titled: String)
    case openLibrary
    case back
    case forward
    case goToNotes
    case goToTags

    var label: String {
        switch self {
        case .newUntitledNote: "New note"
        case .newNote(let title): "New note titled “\(title)”"
        case .openLibrary: "Open Library…"
        case .back: "Back"
        case .forward: "Forward"
        case .goToNotes: "Go to Notes"
        case .goToTags: "Go to Tags"
        }
    }
}
