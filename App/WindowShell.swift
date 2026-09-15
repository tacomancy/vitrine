import SwiftUI

/// The drawn window shell: title bar, tab strip, and the selected tab's body,
/// all on `bg` with no hairlines between them (ADR 0008). The Notes tab is
/// First run until a library is open.
struct WindowShell: View {
    let currentLibrary: CurrentLibrary

    @State private var selectedTab: Tab = .notes
    /// The window's Notes selection, one per window like its library.
    @State private var selection = NotesSelection()
    /// The open note's text, one per window like the selection it follows.
    @State private var buffer: NoteBuffer

    init(currentLibrary: CurrentLibrary) {
        self.currentLibrary = currentLibrary
        _buffer = State(initialValue: NoteBuffer(currentLibrary: currentLibrary))
    }

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
        .focusedSceneValue(\.notesSelection, selection)
        .focusedSceneValue(\.noteBuffer, buffer)
        // A different library takes the selection with it; the same one
        // changed by a save or by another tool keeps it, found again by
        // path — the buffer first, since it decides whether the open note
        // stays open (ADR 0014).
        .onChange(of: currentLibrary.library) { old, new in
            if let new, old?.rootURL == new.rootURL {
                buffer.reconcile(with: new)
                selection.refresh(from: new)
            } else {
                selection.clear()
            }
        }
        // The buffer follows the open note, saving what it held first.
        .onChange(of: selection.openNote?.path) {
            buffer.open(selection.openNote)
        }
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
        case .notes where currentLibrary.library == nil:
            FirstRun(currentLibrary: currentLibrary, selection: selection)
        case .notes:
            NotesTab(currentLibrary: currentLibrary, selection: selection, buffer: buffer)
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
