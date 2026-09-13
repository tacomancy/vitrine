import SwiftUI

/// One tab in the strip. The active tab is `bg-raised` with 3 px top radii,
/// the 2 px sapphire inset rule, and a brass marker (brief rules 2 and 3).
struct TabButton: View {
    let tab: Tab
    let isSelected: Bool
    let isFocused: Bool
    let select: () -> Void

    private static let horizontalPadding: CGFloat = 13
    private static let markerSpacing: CGFloat = 7
    private static let activeRuleHeight: CGFloat = 2
    private static let shape = UnevenRoundedRectangle(
        topLeadingRadius: Radius.medium, topTrailingRadius: Radius.medium)

    var body: some View {
        Button(action: select) {
            HStack(spacing: Self.markerSpacing) {
                tab.marker
                    .foregroundStyle(isSelected ? Color(.accent) : Color(.fgMuted))
                Text(tab.title)
                    .font(.sans(.compact, weight: .regular))
                    .foregroundStyle(isSelected ? Color(.fg) : Color(.fgMuted))
            }
            .padding(.horizontal, Self.horizontalPadding)
            .frame(maxHeight: .infinity)
            .background(isSelected ? Color(.bgRaised) : .clear, in: Self.shape)
            .overlay(alignment: .bottom) {
                if isSelected {
                    Color(.primary).frame(height: Self.activeRuleHeight)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Reachable with Tab whether or not Full Keyboard Access is on, and
        // selectable with Space or Return once focused.
        .focusable(interactions: .activate)
        .onKeyPress(.space) {
            select()
            return .handled
        }
        .onKeyPress(.return) {
            select()
            return .handled
        }
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
