import SwiftUI

/// The drawn 31 px tab strip: every tab (ADR 0005), keyboard-navigable with
/// ← / → and Tab, exposed to accessibility as a tab bar, focus shown as the
/// brass ring.
struct TabStrip: View {
    @Binding var selection: Tab
    @FocusState private var focused: Tab?

    private static let tabSpacing: CGFloat = 2
    private static let horizontalInset: CGFloat = 8
    private static let plusPadding: CGFloat = 10

    var body: some View {
        HStack(spacing: Self.tabSpacing) {
            ForEach(Tab.allCases, id: \.self) { tab in
                TabButton(tab: tab, isSelected: tab == selection, isFocused: focused == tab) {
                    selection = tab
                }
                .focused($focused, equals: tab)
                .onMoveCommand { direction in
                    move(direction, from: tab)
                }
            }
            Text("+")
                .font(.sans(.body, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
                .padding(.horizontal, Self.plusPadding)
                .accessibilityHidden(true)
            Spacer()
        }
        .padding(.horizontal, Self.horizontalInset)
        .frame(height: ShellMetrics.tabStripHeight)
        .background(Color(.bg))
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isTabBar)
    }

    private func move(_ direction: MoveCommandDirection, from tab: Tab) {
        let tabs = Tab.allCases
        guard let index = tabs.firstIndex(of: tab) else { return }
        let next: Int
        switch direction {
        case .left: next = index - 1
        case .right: next = index + 1
        default: return
        }
        guard tabs.indices.contains(next) else { return }
        selection = tabs[next]
        focused = tabs[next]
    }
}
