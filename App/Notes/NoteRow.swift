import Library
import SwiftUI

/// One note list row: the note's title and its modification date on a
/// baseline, then its tag row — `#tag #other` in mono, `link`, one line
/// ellipsised so every row is the same height. Selected, it is the
/// selected-row pill (ADR 0008, Update) and its title steps up to `fg`,
/// semibold.
struct NoteRow: View {
    let note: Note
    /// The note's tags in display spelling, in `Index.tags(of:)` order.
    let tags: [String]
    let isSelected: Bool
    let open: () -> Void

    var body: some View {
        RowButton(isSelected: isSelected, select: open) {
            VStack(alignment: .leading, spacing: NoteListMetrics.tagRowSpacing) {
                HStack(alignment: .firstTextBaseline, spacing: NoteListMetrics.dateSpacing) {
                    Text(note.title)
                        .font(.sans(.compact, weight: isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected ? Color(.fg) : Color(.fgSecondary))
                        .lineLimit(1)
                    Spacer(minLength: NoteListMetrics.dateSpacing)
                    Text(note.modifiedLabel)
                        .font(.mono(.label, weight: .regular))
                        .foregroundStyle(Color(.fgMuted))
                }
                tagRow
            }
            .padding(.vertical, NoteListMetrics.rowPaddingVertical)
            .padding(.horizontal, NoteListMetrics.rowPaddingHorizontal)
        }
        .accessibilityValue(note.modifiedLabel)
    }

    /// A note with no tags keeps the line, so rows stay one height.
    private var tagRow: some View {
        TagRow(tags: tags)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
