import Library
import NoteParsing

/// Resolves what each link and embed in the library points at, by the rules
/// in CONTEXT.md § Links. Pure over the library's tree and the notes'
/// parsed frontmatter: rebuilt with the Index, never stored (ADR 0012).
struct LinkResolver {
    /// Notes by lowercased path, with and without the `.md`.
    private let notesByPath: [String: Note]
    /// Notes by lowercased title, each list in library display order.
    private let notesByTitle: [String: [Note]]
    /// Notes by each lowercased alias they declare, each list in library
    /// display order.
    private let notesByAlias: [String: [Note]]
    /// Attachments by lowercased filename, each list in library display order.
    private let attachmentsByName: [String: [Attachment]]
    /// Attachments by lowercased path.
    private let attachmentsByPath: [String: Attachment]

    /// `read` are the notes whose frontmatter could be read, in library
    /// display order — the only place aliases come from.
    init(library: Library, read: [ReadNote]) {
        var notesByPath: [String: Note] = [:]
        for note in library.allNotes {
            let path = note.path.lowercased()
            notesByPath[path] = note
            notesByPath[String(path.dropLast(Self.noteExtension.count))] = note
        }
        self.notesByPath = notesByPath
        notesByTitle = Dictionary(grouping: library.allNotes) { $0.title.lowercased() }
        let aliases = read.flatMap { note in
            (note.parsed.frontmatter?.aliases ?? []).map {
                (alias: $0.lowercased(), note: note.note)
            }
        }
        notesByAlias = Dictionary(grouping: aliases, by: \.alias).mapValues { $0.map(\.note) }
        let attachments = library.root.allAttachments
        attachmentsByName = Dictionary(grouping: attachments) { $0.name.lowercased() }
        attachmentsByPath = Dictionary(
            uniqueKeysWithValues: attachments.map { ($0.path.lowercased(), $0) })
    }

    /// `link`, as written in `note`, with its target resolved.
    func resolve(_ link: Link, from note: Note) -> ResolvedLink {
        switch link {
        case .wikilink(let wikilink):
            ResolvedLink(
                target: target(ofWikilink: wikilink.target),
                range: wikilink.range,
                displayText: wikilink.displayText ?? wikilink.target,
                isFromFrontmatter: wikilink.isFromFrontmatter)
        case .markdown(let markdown):
            ResolvedLink(
                target: target(ofMarkdownLink: markdown.destination, from: note),
                range: markdown.range,
                displayText: markdown.displayText,
                isFromFrontmatter: false)
        }
    }

    /// `embed`, as written in `note`, resolved the way a wikilink to its
    /// file would be.
    func resolve(_ embed: Embed, from note: Note) -> ResolvedLink {
        ResolvedLink(
            target: target(ofWikilink: embed.filename),
            range: embed.range,
            displayText: embed.filename,
            isFromFrontmatter: false)
    }

    /// A note's path ends in this, in any case (CONTEXT.md, Note).
    private static let noteExtension = ".md"

    /// Obsidian resolves `[[Title]]` case-insensitively, trying in order a
    /// path from the library root, a title, an alias, an attachment's name.
    private func target(ofWikilink target: String) -> LinkTarget {
        let identity = target.lowercased()
        if let note = notesByPath[identity] {
            return .note(note)
        }
        if let note = nearestRoot(among: notesByTitle[identity] ?? [], by: \.path) {
            return .note(note)
        }
        if let note = nearestRoot(among: notesByAlias[identity] ?? [], by: \.path) {
            return .note(note)
        }
        if let attachment = nearestRoot(among: attachmentsByName[identity] ?? [], by: \.path) {
            return .attachment(attachment)
        }
        return .unresolved(target)
    }

    /// A Markdown link's destination is a path relative to the linking
    /// note's folder, already percent-decoded by the parser, to a note or an
    /// attachment; a fragment after `#` is ignored (CONTEXT.md § Links).
    private func target(ofMarkdownLink destination: String, from note: Note) -> LinkTarget {
        let withoutFragment = destination.prefix { $0 != "#" }
        let path = Self.path(withoutFragment, relativeTo: note).lowercased()
        if let note = notesByPath[path] {
            return .note(note)
        }
        if let attachment = attachmentsByPath[path] {
            return .attachment(attachment)
        }
        return .unresolved(destination)
    }

    /// `relative`, joined onto the folder of `note` and normalised, as a path
    /// from the library root: `..` climbs one folder, `.` stays, and either
    /// past the root is dropped.
    private static func path(_ relative: Substring, relativeTo note: Note) -> String {
        var segments = note.path.split(separator: "/").dropLast().map(String.init)
        for segment in relative.split(separator: "/") {
            switch segment {
            case ".": continue
            case "..": _ = segments.popLast()
            default: segments.append(String(segment))
            }
        }
        return segments.joined(separator: "/")
    }

    /// CONTEXT.md § Links: when two notes share a title, the shorter path
    /// wins — the one with fewer folders above it, since a folder's name
    /// should not decide — and at equal depth the first in library display
    /// order, which is alphabetical. `candidates` are in that order.
    private func nearestRoot<Candidate>(
        among candidates: [Candidate], by path: KeyPath<Candidate, String>
    ) -> Candidate? {
        var nearest: (candidate: Candidate, depth: Int)?
        for candidate in candidates {
            let depth = depth(of: candidate[keyPath: path])
            if let nearest, nearest.depth <= depth { continue }
            nearest = (candidate, depth)
        }
        return nearest?.candidate
    }

    private func depth(of path: String) -> Int {
        path.count { $0 == "/" }
    }
}

extension Folder {
    /// This folder's attachments followed by each subfolder's, recursively,
    /// in tree order — the same order as `allNotes`.
    var allAttachments: [Attachment] {
        attachments + folders.flatMap(\.allAttachments)
    }
}
