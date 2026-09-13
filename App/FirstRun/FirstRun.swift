import SwiftUI

/// What the window shows when no library is open (screen 11, v1 subset):
/// the sidebar with nothing to count, and a centered column with the
/// on-disk promise and the one action that opens a folder as a library.
struct FirstRun: View {
    let currentLibrary: CurrentLibrary

    /// With no library there is nothing to select; the sidebar asks anyway.
    @State private var selection = NotesSelection()

    private static let columnWidth: CGFloat = 600
    private static let columnSpacing: CGFloat = 22
    private static let copySpacing: CGFloat = 9
    /// The mockup's 1.65 line height at 13 px, less Inter's own line.
    private static let promiseLineSpacing: CGFloat = 5
    // The sidebar keeps its split-view width and gutter so it doesn't move
    // when a library opens.
    private static let sidebarWidth = PaneWidth.sidebar.ideal ?? PaneWidth.sidebar.minimum

    var body: some View {
        HStack(spacing: 0) {
            Sidebar(currentLibrary: currentLibrary, selection: selection)
                .frame(width: Self.sidebarWidth)
                .padding(ShellMetrics.gutter)
            VStack(alignment: .leading, spacing: Self.columnSpacing) {
                VStack(alignment: .leading, spacing: Self.copySpacing) {
                    Text("Point Vitrine at a folder")
                        .font(.sans(.title, weight: .regular))
                        .tracking(TypeScale.title.rawValue * Tracking.display)
                        .foregroundStyle(Color(.fg))
                    Text(
                        """
                        Your notes stay plain Markdown files on disk. Anything Vitrine adds \
                        lives beside them, never inside — delete the app tomorrow and the \
                        folder still reads.
                        """
                    )
                    .font(.sans(.compact, weight: .regular))
                    .lineSpacing(Self.promiseLineSpacing)
                    .foregroundStyle(Color(.fgSecondary))
                }
                OpenFolderAction {
                    if let folder = LibraryOpenPanel.chooseFolder() {
                        currentLibrary.open(folderAt: folder)
                    }
                }
            }
            .frame(width: Self.columnWidth)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
