import Index
import SwiftUI

/// The chip row above the note list's header: every filter chip in the
/// order it was added, then `+ filter`, wrapping onto more lines when the
/// pane is narrow. `+ filter` opens the popover that adds a chip; with no
/// chips it stands alone.
struct FilterChipRow: View {
    /// The chips as tag paths, in order of addition.
    let chips: [String]
    /// The library's tag tree — what the popover offers, and where a chip
    /// finds its display spelling.
    let tagTree: [TagTreeNode]
    /// Adds a chip for the tag given as a tree node's path.
    let add: (String) -> Void
    let remove: (String) -> Void

    @State private var isChoosing = false
    @FocusState private var isAddFocused: Bool

    /// The mockup's dashed border: 3 px on, 2 px off.
    private static let dash: [CGFloat] = [3, 2]

    var body: some View {
        let tags = Self.everyTag(in: tagTree)
        WrappingRow(spacing: NoteListMetrics.chipSpacing) {
            ForEach(chips, id: \.self) { path in
                FilterChip(tag: display(of: path, among: tags)) { remove(path) }
            }
            addFilter(offering: tags)
        }
    }

    /// Every tag in `tree` in tag tree order: each node, then the nodes
    /// under it, at every depth — the popover's list.
    static func everyTag(in tree: [TagTreeNode]) -> [TagTreeNode] {
        tree.flatMap { [$0] + everyTag(in: $0.children) }
    }

    /// `+ filter`: `fg-muted` at `caption` in a dashed `line-strong` border
    /// (screen 01), the popover anchored under it.
    private func addFilter(offering tags: [TagTreeNode]) -> some View {
        Button {
            isChoosing = true
        } label: {
            Text("+ filter")
                .font(.sans(.caption, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
                .padding(.horizontal, NoteListMetrics.addFilterPaddingHorizontal)
                .frame(height: NoteListMetrics.chipHeight)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.medium)
                        .strokeBorder(
                            Color(.lineStrong),
                            style: StrokeStyle(lineWidth: LineWidth.border, dash: Self.dash))
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused($isAddFocused)
        .brassFocusRing(isFocused: isAddFocused, cornerRadius: Radius.medium)
        .accessibilityLabel("Add filter")
        .popover(isPresented: $isChoosing, arrowEdge: .bottom) {
            FilterPopover(tags: tags, chips: chips) { path in
                isChoosing = false
                add(path)
            }
        }
    }

    /// A chip shows its tag as the tag tree spells it; a tag the tree no
    /// longer has — its notes edited since — shows its path.
    private func display(of path: String, among tags: [TagTreeNode]) -> String {
        tags.first { $0.path == path }?.displaySpelling ?? path
    }
}
