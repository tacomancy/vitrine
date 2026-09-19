import SwiftUI

/// The Tags tab: its sidebar and the tag page as floating panes with
/// gutters all round (ADR 0008, Update), sharing the tab's own selection.
struct TagsTab: View {
    let currentLibrary: CurrentLibrary
    let selection: TagsSelection
    /// *Open in Notes*: the Notes tab, scoped to the page's subject.
    let openInNotes: (TagsSidebarSelection) -> Void

    var body: some View {
        GutterSplitPanes(widths: PaneWidth.tagsTab) {
            [
                GutterSplitPanes.host(
                    TagsSidebar(currentLibrary: currentLibrary, selection: selection)),
                GutterSplitPanes.host(
                    TagPage(
                        currentLibrary: currentLibrary, selection: selection,
                        openInNotes: openInNotes)),
            ]
        }
        .padding(ShellMetrics.gutter)
    }
}
