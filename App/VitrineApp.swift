import SwiftUI

@main
struct VitrineApp: App {
    var body: some Scene {
        // ADR 0007: one library, one main window.
        Window("Vitrine", id: "main") {
            ContentView()
        }
    }
}
