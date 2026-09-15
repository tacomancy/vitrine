import Markdown

/// Walks cmark's tree into the block model (ADR 0019), so that nothing of
/// swift-markdown's — none of it `Sendable` — leaves the seam.
struct BlockConverter {
    let prePass: PrePass

    /// The blocks of `document`, in order.
    func blocks(of document: Document) -> [Block] {
        children(of: document, within: prePass.sourceRange(of: document, within: 0..<0))
    }

    private func children(of container: Markup, within parent: Range<Int>) -> [Block] {
        container.children.flatMap { blocks(of: $0, within: parent) }
    }

    /// The blocks one child of a container becomes: usually one, none for
    /// markup with nothing to draw.
    private func blocks(of markup: Markup, within parent: Range<Int>) -> [Block] {
        let range = prePass.sourceRange(of: markup, within: parent)
        switch markup {
        case let heading as Heading:
            return [
                Block(
                    .heading(level: heading.level, inlines: children(of: heading)),
                    sourceRange: range)
            ]
        default:
            return []
        }
    }

    // MARK: - Inlines

    private func children(of container: Markup) -> [Inline] {
        container.children.flatMap { inlines(of: $0) }
    }

    /// The inlines one child becomes: none for markup with nothing to draw.
    private func inlines(of markup: Markup) -> [Inline] {
        switch markup {
        case let text as Text:
            return [.text(text.string)]
        case let emphasis as Emphasis:
            return [.emphasis(children(of: emphasis))]
        default:
            return []
        }
    }
}
