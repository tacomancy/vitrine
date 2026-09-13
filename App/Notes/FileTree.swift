import Library
import SwiftUI

/// The FILES tree: the library's folders, notes, and attachments as they sit
/// on disk, in the order the `Library` seam gives. Folders expand and
/// collapse; notes and folders select; attachments are shown and nothing more.
struct FileTree: View {
    let root: Folder
    @Binding var selection: SidebarSelection
    /// Expanded folders, by path.
    @Binding var expandedFolders: Set<String>

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(visibleEntries) { entry in
                    row(for: entry)
                }
            }
        }
    }

    @ViewBuilder
    private func row(for entry: FileTreeEntry) -> some View {
        switch entry.kind {
        case .folder(let folder):
            let isExpanded = expandedFolders.contains(folder.path)
            SidebarRow(
                glyph: "folder", name: folder.name, count: nil, depth: entry.depth,
                disclosure: isExpanded ? .expanded : .collapsed,
                state: selection == .folder(folder) ? .selected : .normal
            ) {
                // Obsidian toggles a folder on click; selecting it as well is
                // what lets a folder scope the note list.
                selection = .folder(folder)
                if isExpanded {
                    expandedFolders.remove(folder.path)
                } else {
                    expandedFolders.insert(folder.path)
                }
            }
        case .note(let note):
            SidebarRow(
                glyph: "doc.text", name: note.title, count: nil, depth: entry.depth,
                disclosure: .none, state: selection == .note(note) ? .selected : .normal
            ) {
                selection = .note(note)
            }
        case .attachment(let attachment):
            SidebarRow(
                glyph: "paperclip", name: attachment.name, count: nil, depth: entry.depth,
                disclosure: .none, state: .normal, select: nil)
        }
    }

    /// The tree flattened to what is on screen: the root's entries and, after
    /// each expanded folder, its own, recursively — in display order.
    private var visibleEntries: [FileTreeEntry] {
        entries(of: root, depth: 0)
    }

    private func entries(of folder: Folder, depth: Int) -> [FileTreeEntry] {
        var entries: [FileTreeEntry] = []
        for subfolder in folder.folders {
            entries.append(FileTreeEntry(kind: .folder(subfolder), depth: depth))
            if expandedFolders.contains(subfolder.path) {
                entries += self.entries(of: subfolder, depth: depth + 1)
            }
        }
        entries += folder.notes.map { FileTreeEntry(kind: .note($0), depth: depth) }
        entries += folder.attachments.map { FileTreeEntry(kind: .attachment($0), depth: depth) }
        return entries
    }
}
