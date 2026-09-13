import AppKit

/// The standard open panel, restricted to folders. Besides `Library`, this is
/// the only way the app touches the file system.
enum LibraryOpenPanel {
    /// Runs the panel and returns the chosen folder, or `nil` if cancelled.
    static func chooseFolder() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.message = "Choose a folder of Markdown files to open as a library."
        panel.prompt = "Open"
        guard panel.runModal() == .OK else { return nil }
        return panel.url
    }
}
