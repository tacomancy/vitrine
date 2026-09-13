import SwiftUI

/// The drawn window shell: title bar, tab strip, and the selected tab's body,
/// all on `bg` with no hairlines between them (ADR 0008).
struct WindowShell: View {
    @State private var selectedTab: Tab = .notes

    /// Every pane at its minimum, with a gutter around each.
    private static let minimumWidth =
        PaneWidth.all.map(\.minimum).reduce(0, +)
        + ShellMetrics.gutter * CGFloat(PaneWidth.all.count + 1)
    private static let minimumHeight: CGFloat = 520

    var body: some View {
        VStack(spacing: 0) {
            TitleBar()
            TabStrip(selection: $selectedTab)
            body(for: selectedTab)
        }
        .background(Color(.bg))
        .ignoresSafeArea(.container, edges: .top)
        .frame(minWidth: Self.minimumWidth, minHeight: Self.minimumHeight)
    }

    @ViewBuilder
    private func body(for tab: Tab) -> some View {
        switch tab {
        case .notes: NotesTab()
        case .tags: TagsTab()
        case .sources, .ideas, .dashboard: SoonSurface(tab: tab)
        }
    }
}
