import Library
import SwiftUI

/// One note list row: the note's title and its modification date on a
/// baseline, then its tag row — `#tag #other` in mono, `link`, one line
/// ellipsised so every row is the same height, each tag a click that adds
/// a filter chip. Selected, it is the selected-row pill (ADR 0008, Update)
/// and its title steps up to `fg`, semibold.
struct NoteRow: View {
    let note: Note
    /// The note's tags in display spelling, in `Index.tags(of:)` order.
    let tags: [String]
    let isSelected: Bool
    let open: () -> Void
    let addChip: (String) -> Void

    var body: some View {
        RowButton(isSelected: isSelected, select: open) {
            VStack(alignment: .leading, spacing: NoteListMetrics.tagRowSpacing) {
                HStack(alignment: .firstTextBaseline, spacing: NoteListMetrics.dateSpacing) {
                    Text(note.title)
                        .font(.sans(.compact, weight: isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected ? Color(.fg) : Color(.fgSecondary))
                        .lineLimit(1)
                    Spacer(minLength: NoteListMetrics.dateSpacing)
                    Text(modifiedLabel)
                        .font(.mono(.label, weight: .regular))
                        .foregroundStyle(Color(.fgMuted))
                }
                TagRow(tags: tags, addChip: addChip)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, NoteListMetrics.rowPaddingVertical)
            .padding(.horizontal, NoteListMetrics.rowPaddingHorizontal)
        }
        .accessibilityValue(modifiedLabel)
    }

    /// The mockup's date column: the time for a note modified today, the
    /// day for one modified this year, and the full date for anything older.
    private var modifiedLabel: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(note.modifiedAt) {
            return note.modifiedAt.formatted(date: .omitted, time: .shortened)
        }
        if calendar.isDate(note.modifiedAt, equalTo: .now, toGranularity: .year) {
            return note.modifiedAt.formatted(.dateTime.month(.abbreviated).day())
        }
        return note.modifiedAt.formatted(date: .abbreviated, time: .omitted)
    }
}
