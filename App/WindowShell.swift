import SwiftUI

/// The drawn window shell: title bar, tab strip, and the selected tab's body,
/// all on `bg` with no hairlines between them (ADR 0008). The Notes tab is
/// First run until a library is open.
struct WindowShell: View {
    let currentLibrary: CurrentLibrary

    @State private var selectedTab: Tab = .notes

    /// Every pane at its minimum, with a gutter around each.
    private static let minimumWidth =
        PaneWidth.all.map(\.minimum).reduce(0, +)
        + ShellMetrics.gutter * CGFloat(PaneWidth.all.count + 1)
    private static let minimumHeight: CGFloat = 520

    var body: some View {
        VStack(spacing: 0) {
            TitleBar(libraryName: currentLibrary.library?.name)
            TabStrip(selection: $selectedTab)
            body(for: selectedTab)
        }
        .background(Color(.bg))
        .ignoresSafeArea(.container, edges: .top)
        .frame(minWidth: Self.minimumWidth, minHeight: Self.minimumHeight)
        .alert(
            "Vitrine couldn’t open that folder", isPresented: isShowingOpenFailure,
            presenting: currentLibrary.openFailure
        ) { _ in
            Button("OK") {}
        } message: { failure in
            Text(failure.localizedDescription)
        }
    }

    @ViewBuilder
    private func body(for tab: Tab) -> some View {
        switch tab {
        case .notes where currentLibrary.library == nil: FirstRun(currentLibrary: currentLibrary)
        case .notes: NotesTab(currentLibrary: currentLibrary)
        case .tags: TagsTab()
        case .sources, .ideas, .dashboard: SoonSurface(tab: tab)
        }
    }

    private var isShowingOpenFailure: Binding<Bool> {
        Binding(
            get: { currentLibrary.openFailure != nil },
            set: { isShowing in
                if !isShowing { currentLibrary.openFailure = nil }
            })
    }
}
