import Foundation

/// A folder on disk opened as a unit: the whole tree of folders, notes, and
/// attachments, scanned once at `open(at:)` and immutable after that.
/// Nothing is ever written into the folder (ADR 0002).
public struct Library: Sendable {
    /// The library folder's name, shown in the title bar.
    public let name: String
    /// The library folder itself, as the top of the tree.
    public let root: Folder

    private let rootURL: URL

    /// Every note in the library at every depth, flattened in tree order.
    public var allNotes: [Note] {
        root.allNotes
    }

    /// Opens the folder at `url` as a library: an eager, complete scan of
    /// everything in it. Throws `notAFolder` when `url` is anything but a
    /// folder and `unreadable` when any folder in it cannot be listed.
    public static func open(at url: URL) throws(LibraryError) -> Library {
        var isFolder: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isFolder), isFolder.boolValue
        else { throw .notAFolder }
        let root = try scan(folderAt: url, path: "")
        return Library(name: root.name, root: root, rootURL: url)
    }

    /// The note's full text as it is on disk, frontmatter included. Throws
    /// `noteMissing` when the file has gone since the scan and `unreadable`
    /// when it is there but cannot be read as UTF-8 text.
    public func read(_ note: Note) throws(LibraryError) -> String {
        let url = rootURL.appending(path: note.path)
        guard FileManager.default.fileExists(atPath: url.path) else { throw .noteMissing }
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else {
            throw .unreadable
        }
        return text
    }

    /// Obsidian treats a file as a note when its extension is `md`, in any case.
    private static let noteExtension = "md"

    private static let entryKeys: Set<URLResourceKey> = [
        .isSymbolicLinkKey, .isDirectoryKey, .contentModificationDateKey,
    ]

    private static func scan(folderAt url: URL, path: String) throws(LibraryError) -> Folder {
        guard
            let entries = try? FileManager.default.contentsOfDirectory(
                at: url, includingPropertiesForKeys: Array(entryKeys))
        else { throw .unreadable }

        var folders: [Folder] = []
        var notes: [Note] = []
        var attachments: [Attachment] = []
        for entry in entries {
            let name = entry.lastPathComponent
            // Obsidian hides every dot-entry: .obsidian/, .git/, .DS_Store, and
            // Vitrine's own sidecar (ADR 0002) all disappear under one rule.
            guard !name.hasPrefix(".") else { continue }
            // An entry that vanished between listing and inspection was never
            // part of the library the user opened.
            guard let values = try? entry.resourceValues(forKeys: entryKeys),
                let isSymbolicLink = values.isSymbolicLink,
                let isDirectory = values.isDirectory,
                let modifiedAt = values.contentModificationDate
            else { continue }
            // A symbolic link is neither a note nor a folder of the library;
            // following one could also loop forever.
            guard !isSymbolicLink else { continue }
            let entryPath = path.isEmpty ? name : "\(path)/\(name)"
            if isDirectory {
                folders.append(try scan(folderAt: entry, path: entryPath))
            } else if entry.pathExtension.lowercased() == noteExtension {
                notes.append(
                    Note(
                        name: name,
                        path: entryPath,
                        title: entry.deletingPathExtension().lastPathComponent,
                        modifiedAt: modifiedAt))
            } else {
                attachments.append(Attachment(name: name, path: entryPath))
            }
        }
        return Folder(
            name: url.lastPathComponent,
            path: path,
            folders: folders.sorted { $0.name.isOrderedBefore($1.name) },
            notes: notes.sorted { $0.name.isOrderedBefore($1.name) },
            attachments: attachments.sorted { $0.name.isOrderedBefore($1.name) })
    }
}

extension String {
    /// Finder's and Obsidian's file order: case-insensitive, with digit runs
    /// compared as numbers, so `Note 2` precedes `Note 10`.
    fileprivate func isOrderedBefore(_ other: String) -> Bool {
        localizedStandardCompare(other) == .orderedAscending
    }
}
