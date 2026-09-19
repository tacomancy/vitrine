import Index
import Library
import SwiftUI

/// The sidebar, directly on `bg`: LIBRARY with All Notes, Recent, and Untagged, FILES
/// with the file tree, TOPICS with the tag tree — scrolling as one — and the
/// SCOUTS stub pinned at the bottom (ADR 0005). With no library open it
/// shows All Notes 0, disabled — the one place that color is right, because
/// there genuinely is nothing.
struct Sidebar: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    @State private var expandedFolders: Set<String> = []
    @State private var expandedTags: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    sectionLabel("Library")
                        .padding(.top, SidebarMetrics.topInset)
                    allNotes
                    if let library = currentLibrary.library, let index = currentLibrary.index {
                        recent
                        untagged(in: index)
                        sectionLabel("Files")
                            .padding(.top, SidebarMetrics.sectionSpacing)
                        FileTree(
                            root: library.root, selection: selection,
                            expandedFolders: $expandedFolders)
                        sectionLabel("Topics")
                            .padding(.top, SidebarMetrics.sectionSpacing)
                        TagTree(
                            roots: index.tagTree, selectedPath: selectedTagPath,
                            expandedTags: $expandedTags
                        ) { path in
                            selection.select(tagAt: path)
                        }
                    }
                }
                .padding(.bottom, SidebarMetrics.sectionSpacing)
            }
            Spacer(minLength: 0)
            ScoutsStub()
                .padding(.horizontal, SidebarMetrics.labelInset)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // A different library starts folded; the same one changed by a save
        // or another tool keeps what is open.
        .onChange(of: currentLibrary.library?.rootURL) {
            expandedFolders = []
            expandedTags = []
        }
    }

    /// The tag TOPICS draws selected: the scope, when it is a tag.
    private var selectedTagPath: String? {
        if case .tag(let path) = selection.sidebar { path } else { nil }
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
                selection.selectAllNotes()
            }
        } else {
            SidebarRow(
                glyph: "books.vertical", name: "All Notes", count: 0, depth: 0,
                disclosure: .none, emphasis: .disabled, select: nil)
        }
    }

    /// The notes opened this session (CONTEXT.md, Recent), counted from the
    /// selection: the one list the command palette shows for an empty query.
    private var recent: some View {
        SidebarRow(
            glyph: "clock", name: "Recent", count: selection.recent.count, depth: 0,
            disclosure: .none,
            emphasis: selection.sidebar == .recent ? .selected : .normal
        ) {
            selection.selectRecent()
        }
    }

    private func untagged(in index: Index) -> some View {
        SidebarRow(
            glyph: "tray", name: "Untagged", count: index.untagged.count, depth: 0,
            disclosure: .none,
            emphasis: selection.sidebar == .untagged ? .selected : .normal
        ) {
            selection.selectUntagged()
        }
    }
}
