import SwiftUI

/// The Notes tab: sidebar, note list, editor, and rail as floating panes
/// with gutters all round (ADR 0008, Update), sharing the window's selection.
struct NotesTab: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection
    let buffer: NoteBuffer

    var body: some View {
        GutterSplitPanes(widths: PaneWidth.notesTab) {
            [
                GutterSplitPanes.host(
                    Sidebar(currentLibrary: currentLibrary, selection: selection)),
                GutterSplitPanes.host(
                    NoteList(currentLibrary: currentLibrary, selection: selection)),
                GutterSplitPanes.host(
                    Editor(currentLibrary: currentLibrary, selection: selection, buffer: buffer)),
                GutterSplitPanes.host(Rail(currentLibrary: currentLibrary, selection: selection)),
            ]
        }
        .padding(ShellMetrics.gutter)
    }
}
