import Library
import SwiftUI

/// The note list pane: the notes the sidebar selection scopes to, newest
/// first, under a `N NOTES · MODIFIED ↓` header. Selecting a row opens the
/// note in the editor.
struct NoteList: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let library = currentLibrary.library {
                let notes = notes(in: library)
                CapsLabel(
                    text: "\(notes.count.formatted()) notes · modified ↓", color: Color(.fgMuted)
                )
                .padding(.vertical, NoteListMetrics.headerPaddingVertical)
                .padding(.horizontal, NoteListMetrics.headerInset)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(notes, id: \.path) { note in
                            NoteRow(note: note, isSelected: selection.openNote == note) {
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

    /// Newest first; notes modified at the same instant keep tree order.
    private func notes(in library: Library) -> [Note] {
        selection.sidebar.notes(in: library).sorted { $0.modifiedAt > $1.modifiedAt }
    }
}
