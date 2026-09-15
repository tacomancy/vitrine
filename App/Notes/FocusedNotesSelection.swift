import SwiftUI

/// The key window's `NotesSelection`, for the Go menu: the window shell
/// publishes its selection as a focused scene value and the app's commands
/// read it, since a command has no window of its own to ask.
struct FocusedNotesSelection: FocusedValueKey {
    typealias Value = NotesSelection
}

extension FocusedValues {
    var notesSelection: NotesSelection? {
        get { self[FocusedNotesSelection.self] }
        set { self[FocusedNotesSelection.self] = newValue }
    }
}
