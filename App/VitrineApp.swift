import AppKit
import SwiftUI

@main
struct VitrineApp: App {
    /// The mockups' main-window canvas (design/README.md § 01).
    private static let defaultWindowSize = CGSize(width: 1280, height: 800)
    private static let mainWindowID = "main"

    @State private var currentLibrary: CurrentLibrary
    @Environment(\.openWindow) private var openWindow

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
            // New replaces the system's New and Open: nothing on the menu is inert.
            CommandGroup(replacing: .newItem) {
                Button("Open Library…") {
                    // The window first, so a failure has somewhere to show its alert.
                    openWindow(id: Self.mainWindowID)
                    if let folder = LibraryOpenPanel.chooseFolder() {
                        currentLibrary.open(folderAt: folder)
                    }
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            }
        }
    }
}
