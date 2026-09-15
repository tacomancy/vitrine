import Index
import Library
import SwiftUI

/// The note list pane: the notes the sidebar selection scopes to, newest
/// first — or, for Recent, last opened first — under a `N NOTES ·
/// MODIFIED ↓` (or `OPENED ↓`) header. Selecting a row opens the note in
/// the editor.
struct NoteList: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let library = currentLibrary.library, let index = currentLibrary.index {
                let notes = selection.sidebar.notes(
                    in: library, index: index, recent: selection.recent)
                CapsLabel(
                    text: "\(notes.count.formatted()) notes · \(selection.sidebar.ordering)",
                    color: Color(.fgMuted)
                )
                .padding(.vertical, NoteListMetrics.headerPaddingVertical)
                .padding(.horizontal, NoteListMetrics.headerInset)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(notes, id: \.path) { note in
                            NoteRow(
                                note: note, tags: index.tags(of: note),
                                isSelected: selection.openNote == note
                            ) {
                                selection.open(note)
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .floatingSurface()
    }
}
