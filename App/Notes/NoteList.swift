import Index
import Library
import SwiftUI

/// The note list pane: the filter chip row, then the notes the sidebar
/// selection scopes to that carry every chip's tag, newest first — or,
/// for Recent, last opened first — under a `N NOTES · MODIFIED ↓` (or
/// `OPENED ↓`) header that counts them. Selecting a row opens the note in
/// the editor; clicking a tag in a row adds a chip.
struct NoteList: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let library = currentLibrary.library, let index = currentLibrary.index {
                let notes = notes(in: library, index: index)
                FilterChipRow(
                    chips: selection.chips, tagTree: index.tagTree,
                    add: selection.addChip(forTag:), remove: selection.removeChip
                )
                .padding(.top, NoteListMetrics.headerPaddingVertical)
                .padding(.horizontal, NoteListMetrics.headerInset)
                CapsLabel(
                    text: "\(notes.count.formatted()) notes · \(ordering)", color: Color(.fgMuted)
                )
                .padding(.vertical, NoteListMetrics.headerPaddingVertical)
                .padding(.horizontal, NoteListMetrics.headerInset)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(notes, id: \.path) { note in
                            NoteRow(
                                note: note, tags: index.tags(of: note),
                                isSelected: selection.openNote == note,
                                open: { selection.open(note) },
                                addChip: selection.addChip(forTag:))
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .floatingSurface()
    }

    /// The header's word for the order the rows come in.
    private var ordering: String {
        selection.sidebar == .recent ? "opened ↓" : "modified ↓"
    }

    /// The scope's notes, kept to those carrying every chip's tag or a
    /// descendant of each (CONTEXT.md § Note list), in the scope's own order
    /// — newest first, or last opened first for Recent — since filtering
    /// keeps order and the seam already sorted.
    private func notes(in library: Library, index: Index) -> [Note] {
        var scoped = selection.sidebar.notes(in: library, index: index, recent: selection.recent)
        if !selection.chips.isEmpty {
            let tagged = Set(index.notes(taggedAll: selection.chips).map(\.path))
            scoped.removeAll { !tagged.contains($0.path) }
        }
        return scoped
    }
}
