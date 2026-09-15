import Index
import SwiftUI

/// The tag page (CONTEXT.md § Tag page), a floating surface: the tag at
/// `heading`, `N NOTES · N CHILD TAGS` with *Open in Notes* beside it,
/// its child tags as chips that open their own pages, and CO-OCCURS WITH
/// from `Index.coOccurringTags(with:)` — the top ten as bars, *and N more*
/// below. Untagged has a page of its own: its count and *Open in Notes*.
/// With nothing selected, a prompt. No note list, rail, description,
/// segmented row, or toolbar (ADR 0004, Update). Everything here is read
/// from the Index as it is now, so an edit or another tool's change shows
/// as soon as the Index has it.
struct TagPage: View {
    let currentLibrary: CurrentLibrary
    let selection: TagsSelection
    /// *Open in Notes*: the Notes tab, scoped to the page's subject.
    let openInNotes: (TagsSidebarSelection) -> Void

    /// What the page is about, as the Index has it now.
    private enum Subject {
        /// A selected tag still in the tree: the nodes from its root down,
        /// the last its own.
        case tag(ancestry: [TagTreeNode])
        case untagged
    }

    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(TagPageMetrics.padding)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay {
            // With no library there is no tag to select: the surface stays
            // empty, as the Notes tab's panes do.
            if currentLibrary.index != nil, subject == nil { prompt }
        }
        .floatingSurface()
    }

    /// The selected tag found in the tree, or Untagged; `nil` with nothing
    /// selected — or a selected tag the last edit removed, which leaves the
    /// page with nothing to say about it.
    private var subject: Subject? {
        guard let index = currentLibrary.index, let sidebar = selection.sidebar else { return nil }
        switch sidebar {
        case .tag(let path): return index.tagTree.ancestry(of: path).map(Subject.tag)
        case .untagged: return .untagged
        }
    }

    @ViewBuilder
    private var content: some View {
        if let index = currentLibrary.index, let subject {
            switch subject {
            case .tag(let ancestry):
                if let node = ancestry.last {
                    page(for: node, spelled: ancestry.map(\.name).joined(separator: "/"), in: index)
                }
            case .untagged:
                untaggedPage(count: index.untagged.count)
            }
        }
    }

    private var prompt: some View {
        Text("Select a tag")
            .font(.sans(.body, weight: .regular))
            .foregroundStyle(Color(.fgMuted))
    }

    private func page(for node: TagTreeNode, spelled name: String, in index: Index) -> some View {
        VStack(alignment: .leading, spacing: TagPageMetrics.headerSpacing) {
            heading(name, isTag: true)
            statLine(
                text:
                    "\(node.count.formatted()) notes · \(node.children.count.formatted()) child tags",
                openInNotes: .tag(path: node.path))
            if !node.children.isEmpty {
                WrappingRow(spacing: TagPageMetrics.chipSpacing) {
                    ForEach(node.children, id: \.path) { child in
                        InfoChip(text: "#" + child.name) {
                            selection.reveal(tagAt: child.path)
                        }
                    }
                }
            }
            coOccurrence(of: node, in: index)
                .padding(.top, TagPageMetrics.coOccurrenceTopPadding)
        }
    }

    private func untaggedPage(count: Int) -> some View {
        VStack(alignment: .leading, spacing: TagPageMetrics.headerSpacing) {
            heading("Untagged", isTag: false)
            statLine(text: "\(count.formatted()) notes", openInNotes: .untagged)
        }
    }

    /// The name at `heading` in `fg` — led, for a tag, by `#` in mono
    /// `link`, as the sidebar's tag glyph and the tag row spell it
    /// (screen 09).
    private func heading(_ name: String, isTag: Bool) -> some View {
        let name = Text(name).font(.sans(.heading, weight: .regular)).foregroundStyle(Color(.fg))
        let hashSign = Text("#").font(.mono(.heading, weight: .regular)).foregroundStyle(
            Color(.link))
        return Text("\(isTag ? hashSign : Text(""))\(name)")
            .accessibilityAddTraits(.isHeader)
    }

    /// The caps stat line, and after it the one action on the page: *Open
    /// in Notes* in `link` (rule 2), a plain button with the brass ring.
    private func statLine(text: String, openInNotes subject: TagsSidebarSelection) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TagPageMetrics.statSpacing) {
            CapsLabel(text: text, color: Color(.fgMuted))
            OpenInNotesLink { openInNotes(subject) }
        }
    }

    @ViewBuilder
    private func coOccurrence(of node: TagTreeNode, in index: Index) -> some View {
        if node.count < TagPageMetrics.minimumNotesForCoOccurrence {
            Text(
                "Co-occurrence needs at least \(TagPageMetrics.minimumNotesForCoOccurrence) notes."
            )
            .font(.sans(.caption, weight: .regular))
            .foregroundStyle(Color(.fgMuted))
        } else {
            let entries = index.coOccurringTags(with: node.path)
            let shown = entries.prefix(TagPageMetrics.rowLimit)
            VStack(alignment: .leading, spacing: TagPageMetrics.rowSpacing) {
                CapsLabel(text: "Co-occurs with", color: Color(.fgMuted))
                ForEach(Array(shown.enumerated()), id: \.element.tag) { slot, entry in
                    CoOccurrenceRow(entry: entry, slot: slot + 1)
                }
                if entries.count > shown.count {
                    Text("and \((entries.count - shown.count).formatted()) more")
                        .font(.sans(.caption, weight: .regular))
                        .foregroundStyle(Color(.fgMuted))
                }
            }
            .frame(maxWidth: TagPageMetrics.measure, alignment: .leading)
        }
    }
}
