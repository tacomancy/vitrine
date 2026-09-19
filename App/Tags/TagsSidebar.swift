import Index
import SwiftUI

/// The Tags tab's sidebar, directly on `bg` like the Notes tab's: TAG TREE
/// — the whole tag tree, full height — and UNTAGGED with *Notes with no
/// tag*, scrolling as one (screen 09). Selecting a row gives the tag page
/// its subject.
struct TagsSidebar: View {
    let currentLibrary: CurrentLibrary
    @Bindable var selection: TagsSelection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let index = currentLibrary.index {
                    sectionLabel("Tag tree")
                        .padding(.top, SidebarMetrics.topInset)
                    TagTree(
                        roots: index.tagTree, selectedPath: selectedTagPath,
                        expandedTags: $selection.expandedTags
                    ) { path in
                        selection.select(tagAt: path)
                    }
                    sectionLabel("Untagged")
                        .padding(.top, SidebarMetrics.sectionSpacing)
                    SidebarRow(
                        glyph: "tray", name: "Notes with no tag", count: index.untagged.count,
                        depth: 0, disclosure: .none,
                        emphasis: selection.sidebar == .untagged ? .selected : .normal
                    ) {
                        selection.selectUntagged()
                    }
                }
            }
            .padding(.bottom, SidebarMetrics.sectionSpacing)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var selectedTagPath: String? {
        if case .tag(let path) = selection.sidebar { path } else { nil }
    }

    private func sectionLabel(_ text: String) -> some View {
        CapsLabel(text: text, color: Color(.fgMuted))
            .padding(.horizontal, SidebarMetrics.labelInset)
            .padding(.bottom, SidebarMetrics.labelGap)
    }
}
