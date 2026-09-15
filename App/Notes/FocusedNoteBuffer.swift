import SwiftUI

/// The key window's `NoteBuffer`, for the commands that save it — ⌘S, and
/// Open Library… before it replaces the library — published by the window
/// shell as a focused scene value, as `FocusedNotesSelection` is.
struct FocusedNoteBuffer: FocusedValueKey {
    typealias Value = NoteBuffer
}

extension FocusedValues {
    var noteBuffer: NoteBuffer? {
        get { self[FocusedNoteBuffer.self] }
        set { self[FocusedNoteBuffer.self] = newValue }
    }
}
