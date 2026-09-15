import AppKit
import Index
import Library
import SwiftUI

/// The editor pane (CONTEXT.md § Editor): the open note's path in a
/// breadcrumb bar, its title in a field that renames it, and its source
/// in the text view — editable, its links live: a note link opens in
/// place, an unresolved one creates its note, an attachment or external
/// link opens with the system; a tag clicked adds a filter chip. Between title and text, a bar when the
/// file changed or went under the buffer (ADR 0014). A note that cannot
/// be read shows the reason in place of its text. Empty until a note is
/// open.
struct Editor: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection
    let buffer: NoteBuffer

    @State private var isTextFocused = false
    @FocusState private var isTitleFocused: Bool

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
                TitleField(note: note, rename: rename, isFocused: $isTitleFocused)
                    .padding(.top, Self.pagePadding.top)
                    .padding(.horizontal, Self.pagePadding.leading)
                if let conflict = buffer.conflict {
                    ConflictBar(conflict: conflict, buffer: buffer, selection: selection)
                        .padding(.top, Self.titleSpacing)
                        .padding(.horizontal, Self.pagePadding.leading)
                }
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
        // A note ⌘N just created opens with the caret in its title.
        .onChange(of: buffer.note?.path) {
            if selection.takeTitleFocusRequest() { isTitleFocused = true }
        }
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
                addChip: selection.addChip(for:),
                onFocusChange: { isFocused in
                    isTextFocused = isFocused
                    // ADR 0014: a save at once on focus loss.
                    if !isFocused { buffer.save() }
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // The ring hugs the scroll view, inside the inset that keeps it on the surface.
            .brassFocusRing(isFocused: isTextFocused, cornerRadius: Radius.medium)
            .padding(.horizontal, Self.ringInset)
            .padding(.top, Self.titleSpacing - Self.ringInset)
            .padding(.bottom, Self.ringInset)
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
    /// creates its note in the folder a new note goes in and opens it.
    private func follow(_ destination: BodyLink.Destination, in library: Library) {
        switch destination {
        case .note(let note): selection.open(note)
        // `NSWorkspace` directly, not the `openURL` environment: that one
        // refuses a file URL. False when no app claims the file or scheme,
        // and then nothing opens, as it would not from Finder either.
        case .attachment(let attachment):
            _ = NSWorkspace.shared.open(library.rootURL.appending(path: attachment.path))
        case .external(let url): _ = NSWorkspace.shared.open(url)
        case .unresolved(let title):
            let folder = selection.sidebar.folderForNewNotes(in: library)
            do {
                selection.open(try currentLibrary.createNote(named: title, in: folder))
            } catch {
                currentLibrary.createFailure = error
            }
        }
    }

    /// The title field's rename: the note's path changes under the buffer
    /// and the selection, so both follow before the library's change
    /// reaches the panes — where they still hold it; a note already left
    /// is found again by its new path when that change arrives. Throws
    /// why the rename was refused.
    private func rename(_ note: Note, to title: String) throws(LibraryError) {
        let renamed = try currentLibrary.renameNote(note, to: title)
        if buffer.note?.path == note.path { buffer.renamed(to: renamed) }
        selection.renamed(note, to: renamed)
    }
}
