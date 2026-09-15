import AppKit
import Index
import Library
import SwiftUI

/// The editor pane, read-only in this slice: the open note's path in a
/// breadcrumb bar, its title, and its text exactly as it is on disk,
/// selectable, with its links live — a note link opens in place, an
/// attachment or external link opens with the system. A note that cannot
/// be read shows the reason in place of its text. Empty until a note is
/// selected.
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
            if let library = currentLibrary.library, let index = currentLibrary.index,
                let note = selection.openNote
            {
                breadcrumb(for: note)
                page(for: note, in: library, index: index)
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

    private func page(for note: Note, in library: Library, index: Index) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Self.titleSpacing) {
                Text(note.title)
                    .font(.sans(.title, weight: .semibold))
                    .foregroundStyle(Color(.fg))
                Group {
                    switch text(of: note, in: library) {
                    case .success(let text):
                        NoteBody(
                            text: text,
                            links: BodyLink.all(in: text, resolved: index.links(from: note))
                        ) { destination in
                            follow(destination, in: library)
                        }
                        .lineSpacing(Self.textLineSpacing)
                        .foregroundStyle(Color(.fg))
                        .textSelection(.enabled)
                        // A fresh view per note: the same `Text` given new
                        // content keeps its selection, so a range selected in
                        // one note would show, clamped, over the next.
                        .id(note.path)
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

    /// Following a link (CONTEXT.md § Links): a note opens here and pushes
    /// history, scope untouched; an attachment opens with its default app;
    /// an external link with the system's handler; an unresolved link
    /// leads nowhere yet.
    private func follow(_ destination: BodyLink.Destination, in library: Library) {
        switch destination {
        case .note(let note): selection.open(note)
        // `NSWorkspace` directly, not the `openURL` environment: that one
        // refuses a file URL. False when no app claims the file or scheme,
        // and then nothing opens, as it would not from Finder either.
        case .attachment(let attachment):
            _ = NSWorkspace.shared.open(library.rootURL.appending(path: attachment.path))
        case .external(let url): _ = NSWorkspace.shared.open(url)
        case .unresolved: break
        }
    }

    // Read whenever the pane draws, not once per selection, so selecting a
    // note again after it has changed on disk shows what is there now — or
    // that it has gone — rather than the last read.
    private func text(of note: Note, in library: Library) -> Result<String, LibraryError> {
        Result { () throws(LibraryError) in try library.read(note) }
    }
}
