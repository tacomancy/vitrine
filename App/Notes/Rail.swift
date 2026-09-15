import Index
import Library
import SwiftUI

/// The rail beside the editor (CONTEXT.md § Editor): BACKLINKS — one entry
/// per note that links to the open one, sorted by title, with the line
/// around each link — and INFO — the note's path and modification date,
/// and its tags and link counts from the `Index`. Clicking a backlink
/// opens that note, scope unchanged. Empty until a note is open.
struct Rail: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let index = currentLibrary.index, let note = selection.openNote {
                let backlinks = index.backlinks(to: note)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        sectionLabel("Backlinks")
                            .padding(.top, RailMetrics.topInset)
                        entries(for: backlinks)
                        sectionLabel("Info")
                            .padding(.top, RailMetrics.sectionSpacing)
                        info(of: note, backlinks: backlinks.count, in: index)
                    }
                    .padding(.bottom, RailMetrics.sectionSpacing)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .floatingSurface()
    }

    private func sectionLabel(_ text: String) -> some View {
        CapsLabel(text: text, color: Color(.fgMuted))
            .padding(.horizontal, RailMetrics.inset)
            .padding(.bottom, RailMetrics.labelGap)
    }

    @ViewBuilder
    private func entries(for backlinks: [Backlink]) -> some View {
        if backlinks.isEmpty {
            Text("No notes link here.")
                .font(.sans(.caption, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
                .padding(.horizontal, RailMetrics.inset)
        } else {
            ForEach(backlinks, id: \.note.path) { backlink in
                BacklinkEntry(backlink: backlink) {
                    selection.open(backlink.note)
                }
            }
        }
    }

    private func info(of note: Note, backlinks: Int, in index: Index) -> some View {
        let links = index.links(from: note)
        let unresolved = links.count { if case .unresolved = $0.target { true } else { false } }
        let tags = index.tags(of: note)
        return VStack(alignment: .leading, spacing: RailMetrics.infoSpacing) {
            Text(note.path)
                .font(.mono(.label, weight: .regular))
                .foregroundStyle(Color(.fgSecondary))
                .lineLimit(1)
                .truncationMode(.middle)
            Text(note.modifiedAt.formatted(date: .abbreviated, time: .shortened))
                .font(.sans(.caption, weight: .regular))
                .foregroundStyle(Color(.fgSecondary))
            if !tags.isEmpty {
                // The note list's tag row, verbatim: not a control in this spec.
                Text(tags.map { "#" + $0 }.joined(separator: " "))
                    .font(.mono(.label, weight: .regular))
                    .foregroundStyle(Color(.link))
                    .lineLimit(1)
            }
            Text("\(links.count) links · \(backlinks) backlinks · \(unresolved) unresolved")
                .font(.mono(.label, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
        }
        .padding(.horizontal, RailMetrics.inset)
    }
}
