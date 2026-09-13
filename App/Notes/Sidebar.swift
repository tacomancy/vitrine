import Library
import SwiftUI

/// The sidebar, directly on `bg`: LIBRARY with All Notes, FILES with the
/// file tree, and the SCOUTS stub pinned at the bottom (ADR 0005). With no
/// library open it shows All Notes 0, disabled — the one place that color is
/// right, because there genuinely is nothing.
struct Sidebar: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    @State private var expandedFolders: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("Library")
                .padding(.top, SidebarMetrics.topInset)
            allNotes
            if let library = currentLibrary.library {
                sectionLabel("Files")
                    .padding(.top, SidebarMetrics.sectionSpacing)
                FileTree(
                    root: library.root, selection: selection, expandedFolders: $expandedFolders)
            }
            Spacer(minLength: 0)
            ScoutsStub()
                .padding(.horizontal, SidebarMetrics.labelInset)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onChange(of: currentLibrary.library) {
            expandedFolders = []
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        CapsLabel(text: text, color: Color(.fgMuted))
            .padding(.horizontal, SidebarMetrics.labelInset)
            .padding(.bottom, SidebarMetrics.labelGap)
    }

    @ViewBuilder
    private var allNotes: some View {
        if let library = currentLibrary.library {
            SidebarRow(
                glyph: "books.vertical", name: "All Notes", count: library.allNotes.count,
                depth: 0, disclosure: .none,
                emphasis: selection.sidebar == .allNotes ? .selected : .normal
            ) {
                selection.sidebar = .allNotes
            }
        } else {
            SidebarRow(
                glyph: "books.vertical", name: "All Notes", count: 0, depth: 0,
                disclosure: .none, emphasis: .disabled, select: nil)
        }
    }
}
