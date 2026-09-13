import SwiftUI

/// The Notes tab: sidebar, note list, and editor as floating panes with
/// gutters all round (ADR 0008, Update), sharing one selection.
struct NotesTab: View {
    let currentLibrary: CurrentLibrary

    @State private var selection = NotesSelection()

    var body: some View {
        GutterSplitPanes(currentLibrary: currentLibrary, selection: selection)
            .padding(ShellMetrics.gutter)
            .onChange(of: currentLibrary.library) {
                selection.clear()
            }
    }
}
