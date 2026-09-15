import AppKit
import SwiftUI

@main
struct VitrineApp: App {
    /// The mockups' main-window canvas (design/README.md § 01).
    private static let defaultWindowSize = CGSize(width: 1280, height: 800)
    private static let mainWindowID = "main"

    @State private var currentLibrary: CurrentLibrary
    @Environment(\.openWindow) private var openWindow
    /// The key window's selection, for Back and Forward; nil with no window.
    @FocusedValue(\.notesSelection) private var selection
    /// The key window's open note, for Save; nil with no window.
    @FocusedValue(\.noteBuffer) private var buffer

    init() {
        BundledFonts.register()
        // ADR 0009: dark only in v1. Forced on the application so menus and
        // panels match the window, not just the window's own content.
        NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        let currentLibrary = CurrentLibrary()
        currentLibrary.reopenLast()
        _currentLibrary = State(initialValue: currentLibrary)
    }

    var body: some Scene {
        // ADR 0007: one library, one main window.
        Window("Vitrine", id: Self.mainWindowID) {
            WindowShell(currentLibrary: currentLibrary)
        }
        // ADR 0008: the title bar and tab strip are drawn; the system's is hidden.
        .windowStyle(.hiddenTitleBar)
        .defaultSize(Self.defaultWindowSize)
        .commands {
            // The Edit menu's Find submenu, which the editor's find bar answers
            // (ADR 0013); a Window scene has no Find of its own.
            TextEditingCommands()
            // New Note and Open Library… replace the system's New and Open:
            // nothing on the menu is inert.
            CommandGroup(replacing: .newItem) {
                // ⌘N: an Untitled note in the folder the sidebar has selected,
                // or the root, opened with the caret in its title
                // (spec #38 § Creating).
                Button("New Note") {
                    guard let library = currentLibrary.library, let selection else { return }
                    let folder = selection.sidebar.folderForNewNotes(in: library)
                    guard let note = try? currentLibrary.createUntitledNote(in: folder) else {
                        return
                    }
                    selection.requestTitleFocus()
                    selection.open(note)
                }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(currentLibrary.library == nil || selection == nil)
                Button("Open Library…") {
                    // The window first, so a failure has somewhere to show its alert.
                    openWindow(id: Self.mainWindowID)
                    if let folder = LibraryOpenPanel.chooseFolder() {
                        // ADR 0014: a library switch saves the open note first.
                        buffer?.save()
                        currentLibrary.open(folderAt: folder)
                    }
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            }
            // ⌘S saves the open note at once; with nothing to save it does
            // nothing (ADR 0014).
            CommandGroup(after: .newItem) {
                Divider()
                Button("Save") {
                    buffer?.save()
                }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(buffer == nil)
            }
            // Back and forward walk the notes opened this session
            // (CONTEXT.md § Editor), disabled at either end of the history.
            CommandMenu("Go") {
                Button("Back") {
                    selection?.goBack()
                }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(selection?.canGoBack != true)
                Button("Forward") {
                    selection?.goForward()
                }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(selection?.canGoForward != true)
            }
        }
    }
}
