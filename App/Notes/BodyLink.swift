import Foundation
import Index
import Library
import NoteParsing

/// One link or embed in the open note's text as the editor draws it: the
/// whole token's range, and where following it leads. The tokens come from
/// the parse of the text on screen — ahead of the save that will give it
/// to the Index — so each is resolved as it stands, by the Index's rules
/// (CONTEXT.md § Links); an external link, which the Index keeps in no
/// table, the parser alone identifies.
struct BodyLink {
    enum Destination {
        case note(Note)
        case attachment(Attachment)
        /// A Markdown link or embed whose destination has a URL scheme.
        case external(URL)
        /// Nothing in the library, with the target as written; following
        /// it creates the note (CONTEXT.md, Unresolved link).
        case unresolved(String)
    }

    /// The token as UTF-8 offsets into the text, brackets and `!` included.
    let range: Range<Int>
    let destination: Destination

    /// Every link and embed in `parsed`, in document order, non-overlapping;
    /// `note` is the one the text belongs to, which a Markdown link's path
    /// is relative to.
    static func all(in parsed: ParsedNote, of note: Note, index: Index) -> [BodyLink] {
        let links = parsed.links.compactMap { link -> BodyLink? in
            if case .markdown(let markdown) = link, markdown.isExternal {
                return external(markdown.destination, at: markdown.range)
            }
            return index.resolve(link, from: note).map(BodyLink.init)
        }
        let embeds = parsed.embeds.compactMap { embed -> BodyLink? in
            if MarkdownLink.hasURLScheme(embed.filename) {
                return external(embed.filename, at: embed.range)
            }
            return index.resolve(embed, from: note).map(BodyLink.init)
        }
        return (links + embeds).sorted { $0.range.lowerBound < $1.range.lowerBound }
    }

    private init(_ resolved: ResolvedLink) {
        range = resolved.range
        destination = Destination(resolved.target)
    }

    private init(range: Range<Int>, destination: Destination) {
        self.range = range
        self.destination = destination
    }

    /// A destination the system cannot open as a URL is not a link to anywhere.
    private static func external(_ destination: String, at range: Range<Int>) -> BodyLink? {
        URL(string: destination).map { BodyLink(range: range, destination: .external($0)) }
    }
}

extension BodyLink.Destination {
    init(_ target: LinkTarget) {
        switch target {
        case .note(let note): self = .note(note)
        case .attachment(let attachment): self = .attachment(attachment)
        case .unresolved(let target): self = .unresolved(target)
        }
    }
}
