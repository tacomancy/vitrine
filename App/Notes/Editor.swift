import AppKit
import Index
import Library
import SwiftUI

/// The editor pane (CONTEXT.md § Editor): the open note's path in a
/// breadcrumb bar, its title, and its source in the text view — editable,
/// its links live: a note link opens in place, an attachment or external
/// link opens with the system. A note that cannot be read shows the reason
/// in place of its text. Empty until a note is open.
struct Editor: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection
    let buffer: NoteBuffer

    @State private var isTextFocused = false

    private static let breadcrumbHeight: CGFloat = 34
    private static let breadcrumbInset: CGFloat = 16
    private static let pagePadding = EdgeInsets(top: 20, leading: 36, bottom: 20, trailing: 36)
    private static let titleSpacing: CGFloat = 11
    private static let measure: CGFloat = 720
    /// Room inside the surface for the brass ring, drawn 2 px outside the
    /// text view and 2 px wide.
    private static let ringInset: CGFloat = 4

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let library = currentLibrary.library, let index = currentLibrary.index,
                let note = buffer.note
            {
                breadcrumb(for: note)
                Text(note.title)
                    .font(.sans(.title, weight: .semibold))
                    .foregroundStyle(Color(.fg))
                    .padding(.top, Self.pagePadding.top)
                    .padding(.horizontal, Self.pagePadding.leading)
                if let failure = buffer.saveFailure {
                    // The one thing the buffer says about itself: a save that
                    // could not write, so the text on screen is not on disk.
                    Text(failure.localizedDescription)
                        .font(.sans(.caption, weight: .regular))
                        .foregroundStyle(Color(.danger))
                        .padding(.top, Self.titleSpacing)
                        .padding(.horizontal, Self.pagePadding.leading)
                }
                text(of: note, in: library, index: index)
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

    @ViewBuilder
    private func text(of note: Note, in library: Library, index: Index) -> some View {
        if let parsed = buffer.parsed {
            NoteTextView(
                note: note, parsed: parsed, index: index, measure: Self.measure,
                inset: NSSize(
                    width: Self.pagePadding.leading - Self.ringInset,
                    height: Self.pagePadding.bottom - Self.ringInset),
                onEdit: buffer.edit,
                follow: { destination in follow(destination, in: library) },
                onFocusChange: { isFocused in
                    isTextFocused = isFocused
                    // ADR 0014: a save at once on focus loss.
                    if !isFocused { buffer.save() }
                }
            )
            .padding(.horizontal, Self.ringInset)
            .padding(.top, Self.titleSpacing - Self.ringInset)
            .padding(.bottom, Self.ringInset)
            .brassFocusRing(isFocused: isTextFocused, cornerRadius: Radius.medium)
        } else if let failure = buffer.readFailure {
            Text(failure.localizedDescription)
                .font(.sans(.body, weight: .regular))
                .foregroundStyle(Color(.danger))
                .padding(.top, Self.titleSpacing)
                .padding(.horizontal, Self.pagePadding.leading)
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
}
