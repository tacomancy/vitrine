import SwiftUI

@main
struct VitrineApp: App {
    var body: some Scene {
        // ADR 0007: one library, one main window.
        Window("Vitrine", id: "main") {
            ContentView()
        }
        // PROTOTYPE (prototype/window-chrome): hidden title bar so the chrome can be drawn.
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1280, height: 800)
    }
}
