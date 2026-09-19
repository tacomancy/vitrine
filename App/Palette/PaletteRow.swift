import Library
import Search

/// One row of the command palette: a search result under NOTES, a recent
/// note there when the query is empty, or an action under ACTIONS. The
/// highlight moves over all of them as one list.
enum PaletteRow: Equatable {
    case result(SearchResult)
    case recent(Note)
    case action(PaletteAction)

    /// The note the row opens, for the two kinds of row that open one.
    var note: Note? {
        switch self {
        case .result(let result): result.note
        case .recent(let note): note
        case .action: nil
        }
    }

    /// The mockup's mono kind tag at the row's leading edge.
    var kindTag: String {
        switch self {
        case .result, .recent: "NOTE"
        case .action: "DO"
        }
    }

    var label: String {
        switch self {
        case .result(let result): result.note.title
        case .recent(let note): note.title
        case .action(let action): action.label
        }
    }

    /// Where the query's terms fall in the label, for the wash: a
    /// result's `titleRanges`, and nothing on any other row.
    var labelRanges: [Range<Int>] {
        if case .result(let result) = self { result.titleRanges } else { [] }
    }

    /// The mockup's right-aligned meta: a note's modification date.
    var meta: String? {
        note?.modifiedLabel
    }
}
