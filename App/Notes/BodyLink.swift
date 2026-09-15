import Foundation
import Index
import Library
import NoteParsing

/// One link or embed in the open note's text as the body draws it: the
/// whole token's range, and where following it leads. The tokens come from
/// parsing the text on screen, so every range is in it; what each points
/// at comes from the `Index`, which keeps external links in no table
/// (CONTEXT.md § Links) — those the parser alone identifies.
struct BodyLink {
    enum Destination {
        case note(Note)
        case attachment(Attachment)
        /// A Markdown link or embed whose destination has a URL scheme.
        case external(URL)
        /// Nothing in the library; following it does nothing until editing
        /// exists (CONTEXT.md, Unresolved link).
        case unresolved
    }

    /// The token as UTF-8 offsets into the text, brackets and `!` included.
    let range: Range<Int>
    let destination: Destination

    /// Every link and embed in `text` that the Index knows, plus every
    /// external one, in document order, non-overlapping. `resolved` is
    /// `Index.links(from:)` for the same note; a token it does not know by
    /// range — the file changed after the library opened — is left out,
    /// and reads as plain text.
    static func all(in text: String, resolved: [ResolvedLink]) -> [BodyLink] {
        let parsed = ParsedNote.parse(text)
        let targets = Dictionary(
            resolved.map { ($0.range, $0.target) }, uniquingKeysWith: { first, _ in first })
        let links = parsed.links.compactMap { link -> BodyLink? in
            if case .markdown(let markdown) = link, markdown.isExternal {
                return external(markdown.destination, at: markdown.range)
            }
            return targets[link.range].map { BodyLink(range: link.range, destination: .init($0)) }
        }
        let embeds = parsed.embeds.compactMap { embed -> BodyLink? in
            if MarkdownLink.hasURLScheme(embed.filename) {
                return external(embed.filename, at: embed.range)
            }
            return targets[embed.range].map { BodyLink(range: embed.range, destination: .init($0)) }
        }
        return (links + embeds).sorted { $0.range.lowerBound < $1.range.lowerBound }
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
        case .unresolved: self = .unresolved
        }
    }
}
