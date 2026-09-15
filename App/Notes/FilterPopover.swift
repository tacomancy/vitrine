import SwiftUI

/// The `+ filter` popover: a field and the library's tags in tag tree
/// order, kept to those whose path contains what is typed. ↑ ↓ move the
/// highlight over the tags not yet chipped, ↩ or a click adds the
/// highlighted or clicked one, Esc closes; a tag already chipped is shown
/// disabled. No counts, no fuzzy matching (spec #72).
struct FilterPopover: View {
    let choices: [TagChoice]
    /// The chips as tag paths — the choices shown disabled.
    let chips: [String]
    /// Adds the tag at this path as a chip; the caller closes the popover.
    let add: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    /// The path under the keyboard highlight, always one of `selectable`.
    @State private var highlighted: String?
    @FocusState private var isFieldFocused: Bool

    private static let width: CGFloat = 240
    private static let padding: CGFloat = 8
    /// Between the field and the first row.
    private static let fieldGap: CGFloat = 6
    private static let fieldPadding = EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8)
    private static let fieldBorderWidth: CGFloat = 1
    /// The list shows this many rows before it scrolls.
    private static let visibleRows: CGFloat = 10

    var body: some View {
        VStack(alignment: .leading, spacing: Self.fieldGap) {
            field
            list
        }
        .padding(Self.padding)
        .frame(width: Self.width)
        .presentationBackground(Color(.bgRaised))
        .onAppear {
            isFieldFocused = true
            highlighted = selectable.first
        }
        .onChange(of: query) {
            highlighted = selectable.first
        }
        .onExitCommand { dismiss() }
    }

    /// The tags whose path contains the query, case-insensitively — a path
    /// is lowercase — in tag tree order; every tag with nothing typed.
    private var shown: [TagChoice] {
        let needle = query.lowercased()
        return needle.isEmpty ? choices : choices.filter { $0.path.contains(needle) }
    }

    /// The shown tags that are not chips yet: what the highlight walks.
    private var selectable: [String] {
        shown.map(\.path).filter { !chips.contains($0) }
    }

    private var field: some View {
        TextField("Tag", text: $query)
            .textFieldStyle(.plain)
            .font(.sans(.compact, weight: .regular))
            .foregroundStyle(Color(.fg))
            .focused($isFieldFocused)
            .padding(Self.fieldPadding)
            .background(Color(.bgSurface), in: RoundedRectangle(cornerRadius: Radius.medium))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.medium)
                    .strokeBorder(Color(.lineControl), lineWidth: Self.fieldBorderWidth)
            }
            .brassFocusRing(isFocused: isFieldFocused, cornerRadius: Radius.medium)
            .onSubmit(addHighlighted)
            .onKeyPress(.upArrow) {
                moveHighlight(by: -1)
                return .handled
            }
            .onKeyPress(.downArrow) {
                moveHighlight(by: 1)
                return .handled
            }
            .accessibilityLabel("Filter tags")
    }

    @ViewBuilder
    private var list: some View {
        if shown.isEmpty {
            Text("No tags match.")
                .font(.sans(.caption, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
                .padding(.horizontal, SidebarMetrics.labelInset)
                .padding(.vertical, Self.fieldGap)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(shown) { choice in
                            TagChoiceRow(choice: choice, emphasis: emphasis(of: choice)) {
                                add(choice.path)
                            }
                            .id(choice.path)
                        }
                    }
                }
                .frame(maxHeight: SidebarMetrics.rowHeight * Self.visibleRows)
                .onChange(of: highlighted) { _, highlighted in
                    if let highlighted { proxy.scrollTo(highlighted) }
                }
            }
        }
    }

    private func emphasis(of choice: TagChoice) -> TagChoiceRow.Emphasis {
        if chips.contains(choice.path) { return .chipped }
        return choice.path == highlighted ? .highlighted : .normal
    }

    /// ↑ ↓: the highlight moves one selectable tag, stopping at either end.
    private func moveHighlight(by offset: Int) {
        let selectable = selectable
        guard let highlighted, let index = selectable.firstIndex(of: highlighted) else {
            self.highlighted = selectable.first
            return
        }
        let moved = index + offset
        guard selectable.indices.contains(moved) else { return }
        self.highlighted = selectable[moved]
    }

    private func addHighlighted() {
        guard let highlighted else { return }
        add(highlighted)
    }
}
