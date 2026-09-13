import AppKit
import SwiftUI

@main
struct VitrineApp: App {
    /// The mockups' main-window canvas (design/README.md § 01).
    private static let defaultWindowSize = CGSize(width: 1280, height: 800)

    init() {
        BundledFonts.register()
        // ADR 0009: dark only in v1. Forced on the application so menus and
        // panels match the window, not just the window's own content.
        NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
    }

    var body: some Scene {
        // ADR 0007: one library, one main window.
        Window("Vitrine", id: "main") {
            WindowShell()
        }
        // ADR 0008: the title bar and tab strip are drawn; the system's is hidden.
        .windowStyle(.hiddenTitleBar)
        .defaultSize(Self.defaultWindowSize)
    }
}
