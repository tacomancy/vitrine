import Foundation

/// A folder on disk opened as a unit: the whole tree of folders, notes, and
/// attachments, scanned once at `open(at:)`. A value: writing, creating, and
/// renaming notes replace the tree in place, and `applying(_:)` folds in what
/// another tool did. Opening writes nothing into the folder (ADR 0002); the
/// only files Vitrine ever writes are notes. Two libraries are equal when
/// they were opened from the same folder and hold the same tree, so a view
/// can tell a replaced library from a re-opened one.
public struct Library: Sendable, Equatable {
    /// The library folder's name, shown in the title bar.
    public let name: String
    /// The library folder itself, as the top of the tree.
    public let root: Folder

    /// The library folder on disk — where the tree was scanned from and
    /// where every note in it is read and written.
    public let rootURL: URL

    /// Every note in the library at every depth, flattened in tree order.
    public var allNotes: [Note] {
        root.allNotes
    }

    /// Opens the folder at `url` as a library: an eager, complete scan of
    /// everything in it. Throws `notAFolder` when `url` is anything but a
    /// folder and `unreadable` when any folder in it cannot be listed.
    public static func open(at url: URL) throws(LibraryError) -> Library {
        var isFolder: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isFolder),
            isFolder.boolValue
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
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8)
        else {
            throw .unreadable
        }
        return text
    }

    /// Overwrites the note on disk with `text` — in place, as UTF-8 without a
    /// byte-order mark, the buffer exactly as given (ADR 0014: line endings
    /// and frontmatter are the caller's, never normalized). Throws
    /// `noteMissing` when the file has gone since the scan and `unwritable`
    /// when it is there but cannot be written.
    public mutating func write(_ text: String, to note: Note) throws(LibraryError) {
        let url = rootURL.appending(path: note.path)
        guard FileManager.default.fileExists(atPath: url.path) else { throw .noteMissing }
        // ADR 0014: in place, not write-and-rename — Obsidian and every sync
        // client see a plain modification of the same inode.
        guard let file = try? FileHandle(forWritingTo: url) else { throw .unwritable }
        do {
            try file.truncate(atOffset: 0)
            try file.write(contentsOf: Data(text.utf8))
            try file.close()
        } catch {
            throw .unwritable
        }
        self = refreshingModifiedAt(ofNoteAt: note.path)
    }

    /// Creates an empty note titled `title` in `folder` and returns it as it
    /// now sits in the tree. Throws `invalidName` for a title that is
    /// empty, begins with `.`, or contains `/`; `nameTaken` when a note in
    /// that folder already has the title (compared case-insensitively, as
    /// the file system does); `unwritable` when the file cannot be created.
    public mutating func createNote(named title: String, in folder: Folder) throws(LibraryError)
        -> Note
    {
        try validate(title: title, in: folder, renaming: nil)
        let path = Self.path(ofNoteTitled: title, in: folder.path)
        let url = rootURL.appending(path: path)
        guard (try? Data().write(to: url, options: .withoutOverwriting)) != nil else {
            throw .unwritable
        }
        return try noteAfterRescanning(folderAt: folder.path, noteAt: path)
    }

    /// Renames `note` to `title`, in the folder it is in, and returns it as it
    /// now sits in the tree. Links to the note elsewhere are not rewritten —
    /// rename as a feature is parked (BACKLOG.md); this exists for the new
    /// note's title field. Throws `invalidName` and `nameTaken` as
    /// `createNote` does — a note may change only the case of its own title —
    /// `noteMissing` when the file has gone since the scan, and `unwritable`
    /// when it cannot be renamed.
    public mutating func renameNote(_ note: Note, to title: String) throws(LibraryError) -> Note {
        let folderPath = Self.parentPath(of: note.path)
        guard let folder = folder(at: folderPath) else { throw .noteMissing }
        try validate(title: title, in: folder, renaming: note)
        let url = rootURL.appending(path: note.path)
        guard FileManager.default.fileExists(atPath: url.path) else { throw .noteMissing }
        let path = Self.path(ofNoteTitled: title, in: folderPath)
        guard (try? FileManager.default.moveItem(at: url, to: rootURL.appending(path: path))) != nil
        else { throw .unwritable }
        return try noteAfterRescanning(folderAt: folderPath, noteAt: path)
    }

    /// The tree with `change` — something another tool did on disk —
    /// reflected: the folder around an added, removed, or renamed entry is
    /// scanned again by the rules of `open(at:)` (ADR 0014); a modified note
    /// takes its new modification date. A folder that can no longer be
    /// listed leaves the tree as it was.
    public func applying(_ change: LibraryChange) -> Library {
        switch change {
        case .entryAdded(let path), .entryRemoved(let path):
            (try? rescanning(folderAt: Self.parentPath(of: path))) ?? self
        case .entryRenamed(let from, let to):
            applying(.entryRemoved(from)).applying(.entryAdded(to))
        case .folderChanged(let path):
            (try? rescanning(folderAt: path)) ?? self
        case .noteModified(let path):
            refreshingModifiedAt(ofNoteAt: path)
        case .attachmentModified:
            // The tree holds nothing about an attachment that its contents change.
            self
        }
    }

    /// Refuses a title no note may have in `folder`: empty, beginning with
    /// `.` (the scan would hide it), holding a path separator, or already
    /// carried by one of the folder's notes other than the one being renamed.
    private func validate(title: String, in folder: Folder, renaming note: Note?)
        throws(LibraryError)
    {
        guard !title.isEmpty, !title.hasPrefix("."), !title.contains("/") else {
            throw .invalidName
        }
        let others = notes(in: folder).filter { $0.path != note?.path }
        guard !others.contains(where: { $0.title.lowercased() == title.lowercased() }) else {
            throw .nameTaken
        }
    }

    /// The notes directly in `folder` as the tree holds them now — `folder`
    /// itself may be a snapshot from before the last change.
    private func notes(in folder: Folder) -> [Note] {
        (self.folder(at: folder.path) ?? folder).notes
    }

    /// The tree with the folder at `folderPath` scanned afresh, and the note
    /// the caller just put at `path` as the scan found it. Throws
    /// `noteMissing` when it is not there — gone again before the scan.
    private mutating func noteAfterRescanning(folderAt folderPath: String, noteAt path: String)
        throws(LibraryError) -> Note
    {
        self = try rescanning(folderAt: folderPath)
        guard let note = note(at: path) else { throw .noteMissing }
        return note
    }

    /// The title a new note in `folder` gets when the user hasn't given one:
    /// `Untitled`, or `Untitled 1`, `Untitled 2`, … — the first the folder's
    /// notes don't already carry, compared case-insensitively.
    public func uniqueUntitledName(in folder: Folder) -> String {
        let untitled = "Untitled"
        let taken = Set(notes(in: folder).map { $0.title.lowercased() })
        guard taken.contains(untitled.lowercased()) else { return untitled }
        var counter = 1
        while taken.contains("\(untitled) \(counter)".lowercased()) { counter += 1 }
        return "\(untitled) \(counter)"
    }

    /// The folder at `path` — relative to the root; empty for the root
    /// itself — as the tree holds it now, or nil when nothing is there. A
    /// folder is a snapshot: after a write, the tree's copy is the current
    /// one, and this is how a holder of an old copy finds it.
    public func folder(at path: String) -> Folder? {
        var folder = root
        for name in path.split(separator: "/") {
            guard let child = folder.folders.first(where: { $0.name == name }) else { return nil }
            folder = child
        }
        return folder
    }

    /// The note at `path` — relative to the root — as the tree holds it now,
    /// or nil when nothing is there. A note carries its modification date,
    /// so after a write the tree's copy is the current one (CONTEXT.md, Note).
    public func note(at path: String) -> Note? {
        folder(at: Self.parentPath(of: path))?.notes.first { $0.path == path }
    }

    /// The tree with the folder at `path` scanned afresh, by the same rules
    /// as `open(at:)`. Throws `unreadable` when the folder cannot be listed.
    private func rescanning(folderAt path: String) throws(LibraryError) -> Library {
        let rescanned = try Self.scan(folderAt: rootURL.appending(path: path), path: path)
        let root = root.replacingFolder(at: path) { _ in rescanned }
        return Library(name: name, root: root, rootURL: rootURL)
    }

    /// The tree with the note at `path` carrying the modification date the
    /// file system reports now; unchanged when the file cannot be inspected.
    private func refreshingModifiedAt(ofNoteAt path: String) -> Library {
        let url = rootURL.appending(path: path)
        guard
            let modifiedAt = try? url.resourceValues(forKeys: [.contentModificationDateKey])
                .contentModificationDate
        else { return self }
        let root = root.replacingFolder(at: Self.parentPath(of: path)) { folder in
            folder.with(
                notes: folder.notes.map { note in
                    note.path == path ? note.with(modifiedAt: modifiedAt) : note
                })
        }
        return Library(name: name, root: root, rootURL: rootURL)
    }

    /// The path, relative to the root, of the entry named `name` in the
    /// folder at `folderPath`.
    private static func path(of name: String, in folderPath: String) -> String {
        folderPath.isEmpty ? name : "\(folderPath)/\(name)"
    }

    /// The path of the note titled `title` in the folder at `folderPath`.
    private static func path(ofNoteTitled title: String, in folderPath: String) -> String {
        path(of: "\(title).\(noteExtension)", in: folderPath)
    }

    /// The path of the folder holding the entry at `path`; empty for the root.
    private static func parentPath(of path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return "" }
        return String(path[..<slash])
    }

    /// Obsidian treats a file as a note when its extension is `md`, in any case.
    private static let noteExtension = "md"

    /// Whether the file at `path` — relative to the root, or any path — is a
    /// note by name: the one rule (CONTEXT.md § Note), for anything that
    /// meets a file before the tree does.
    public static func isNote(_ path: String) -> Bool {
        URL(filePath: path).pathExtension.lowercased() == noteExtension
    }

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
            let entryPath = Self.path(of: name, in: path)
            if isDirectory {
                folders.append(try scan(folderAt: entry, path: entryPath))
            } else if isNote(name) {
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
            folders: folders.sorted { isInDisplayOrder($0.name, $1.name) },
            notes: notes.sorted { isInDisplayOrder($0.name, $1.name) },
            attachments: attachments.sorted { isInDisplayOrder($0.name, $1.name) })
    }

    /// Finder's and Obsidian's file order: case-insensitive, with digit runs
    /// compared as numbers, so `Note 2` precedes `Note 10`.
    private static func isInDisplayOrder(_ name: String, _ other: String) -> Bool {
        name.localizedStandardCompare(other) == .orderedAscending
    }
}
