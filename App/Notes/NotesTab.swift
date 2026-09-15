import SwiftUI

/// The Notes tab: sidebar, note list, and editor as floating panes with
/// gutters all round (ADR 0008, Update), sharing the window's selection.
struct NotesTab: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection
    let buffer: NoteBuffer

    var body: some View {
        GutterSplitPanes(currentLibrary: currentLibrary, selection: selection, buffer: buffer)
            .padding(ShellMetrics.gutter)
    }
}
