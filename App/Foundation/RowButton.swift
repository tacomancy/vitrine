import SwiftUI

/// A list row that selects on click: its content in the selected-row pill,
/// as a plain button that takes the brass ring when focused, inset from
/// its pane, and marked selected for accessibility.
struct RowButton<Content: View>: View {
    let isSelected: Bool
    let select: () -> Void
    @ViewBuilder let content: () -> Content

    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: select) {
            content().selectedRowPill(isSelected: isSelected)
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
        .padding(.horizontal, SelectedRowPill.inset)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
