import SwiftUI

/// The key window's `PaletteState`, for ⌘K: published by the window shell
/// as a focused scene value, as `FocusedNotesSelection` is, since a command
/// has no window of its own to ask.
struct FocusedPaletteState: FocusedValueKey {
    typealias Value = PaletteState
}

extension FocusedValues {
    var paletteState: PaletteState? {
        get { self[FocusedPaletteState.self] }
        set { self[FocusedPaletteState.self] = newValue }
    }
}
