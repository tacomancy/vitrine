import SwiftUI

/// The selected-row treatment every list row shares (ADR 0008, Update): a
/// `bg-raised` pill at `Radius.medium` with the 2 px `primary` rule along
/// its left edge. An unselected row draws both clear, so its content sits
/// where a selected row's does.
struct SelectedRowPill: ViewModifier {
    let isSelected: Bool

    /// How far a row's pill sits in from its pane's edges.
    static let inset: CGFloat = 4
    static let ruleWidth: CGFloat = 2
    static let shape = RoundedRectangle(cornerRadius: Radius.medium)

    func body(content: Content) -> some View {
        content
            .padding(.leading, Self.ruleWidth)
            // An overlay takes the content's height; a rule beside the content
            // in a stack would take all the height the pane offers.
            .overlay(alignment: .leading) {
                if isSelected {
                    Color(.primary).frame(width: Self.ruleWidth)
                }
            }
            .background(isSelected ? Color(.bgRaised) : Color.clear, in: Self.shape)
            .clipShape(Self.shape)
            .contentShape(Rectangle())
    }
}

extension View {
    func selectedRowPill(isSelected: Bool) -> some View {
        modifier(SelectedRowPill(isSelected: isSelected))
    }
}
