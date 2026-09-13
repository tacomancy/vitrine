import Library
import SwiftUI

/// The editor pane, read-only in this slice: the open note's path in a
/// breadcrumb bar, its title, and its text exactly as it is on disk,
/// selectable. A note that cannot be read shows the reason in place of its
/// text. Empty until a note is selected.
struct Editor: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    private static let breadcrumbHeight: CGFloat = 34
    private static let breadcrumbInset: CGFloat = 16
    private static let pagePadding = EdgeInsets(top: 20, leading: 36, bottom: 20, trailing: 36)
    private static let titleSpacing: CGFloat = 11
    /// The mockup's 1.65 line height at 14 px, less Inter's own line.
    private static let textLineSpacing: CGFloat = 6
    private static let measure: CGFloat = 720

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let library = currentLibrary.library, let note = selection.openNote {
                breadcrumb(for: note)
                page(for: note, in: library)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .floatingSurface()
    }

    private func breadcrumb(for note: Note) -> some View {
        Text(note.path.replacingOccurrences(of: "/", with: " / "))
            .font(.mono(.label, weight: .regular))
            .foregroundStyle(Color(.fgMuted))
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, Self.breadcrumbInset)
            .frame(height: Self.breadcrumbHeight)
    }

    private func page(for note: Note, in library: Library) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Self.titleSpacing) {
                Text(note.title)
                    .font(.sans(.title, weight: .semibold))
                    .foregroundStyle(Color(.fg))
                Group {
                    switch text(of: note, in: library) {
                    case .success(let text):
                        Text(verbatim: text)
                            .lineSpacing(Self.textLineSpacing)
                            .foregroundStyle(Color(.fg))
                            .textSelection(.enabled)
                    case .failure(let error):
                        Text(error.localizedDescription)
                            .foregroundStyle(Color(.danger))
                    }
                }
                .font(.sans(.body, weight: .regular))
            }
            .frame(maxWidth: Self.measure, alignment: .leading)
            .padding(Self.pagePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // Read whenever the pane draws, not once per selection, so selecting a
    // note again after it has changed on disk shows what is there now — or
    // that it has gone — rather than the last read.
    private func text(of note: Note, in library: Library) -> Result<String, LibraryError> {
        Result { () throws(LibraryError) in try library.read(note) }
    }
}
