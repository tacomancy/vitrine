import Library
import SwiftUI

/// One note list row: the note's title and its modification date on a
/// baseline. Selected, it is the `bg-raised` pill with the 2 px sapphire
/// rule (ADR 0008, Update) and its title steps up to `fg`, semibold.
struct NoteRow: View {
    let note: Note
    let isSelected: Bool
    let open: () -> Void

    @FocusState private var isFocused: Bool

    private static let shape = RoundedRectangle(cornerRadius: Radius.medium)

    var body: some View {
        Button(action: open) {
            HStack(spacing: 0) {
                (isSelected ? Color(.primary) : Color.clear)
                    .frame(width: NoteListMetrics.ruleWidth)
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
                .padding(.vertical, NoteListMetrics.rowPaddingVertical)
                .padding(.horizontal, NoteListMetrics.rowPaddingHorizontal)
            }
            .background(isSelected ? Color(.bgRaised) : Color.clear, in: Self.shape)
            .clipShape(Self.shape)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
        .padding(.horizontal, NoteListMetrics.rowInset)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
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
