import Foundation
import Library

extension Note {
    /// The mockup's date column, as the note list and the command palette
    /// both draw it: the time for a note modified today, the day for one
    /// modified this year, and the full date for anything older.
    var modifiedLabel: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(modifiedAt) {
            return modifiedAt.formatted(date: .omitted, time: .shortened)
        }
        if calendar.isDate(modifiedAt, equalTo: .now, toGranularity: .year) {
            return modifiedAt.formatted(.dateTime.month(.abbreviated).day())
        }
        return modifiedAt.formatted(date: .abbreviated, time: .omitted)
    }
}
