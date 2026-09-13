import SwiftUI

/// The Notes tab: sidebar, note list, and editor as floating panes with
/// gutters all round (ADR 0008, Update).
struct NotesTab: View {
    let currentLibrary: CurrentLibrary

    var body: some View {
        GutterSplitPanes(currentLibrary: currentLibrary).padding(ShellMetrics.gutter)
    }
}
