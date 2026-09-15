import Foundation
import Markdown
import NoteParsing

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
        case let heading as Markdown.Heading:
            return [
                Block(
                    .heading(level: heading.level, inlines: children(of: heading)),
                    sourceRange: range)
            ]
        case let paragraph as Paragraph:
            return blocks(of: paragraph, within: range)
        case let list as UnorderedList:
            return [Block(self.list(list, isOrdered: false, start: 1, within: range), sourceRange: range)]
        case let list as OrderedList:
            return [
                Block(
                    self.list(list, isOrdered: true, start: Int(list.startIndex), within: range),
                    sourceRange: range)
            ]
        case let code as CodeBlock:
            return [
                Block(
                    .codeBlock(language: code.language?.firstWord, text: code.code.trimmingTrailingNewline),
                    sourceRange: range)
            ]
        case let quote as BlockQuote:
            return [Block(.quote(children(of: quote, within: range)), sourceRange: range)]
        case let table as Table:
            return [
                Block(
                    .table(
                        header: table.head.cells.map(children(of:)),
                        rows: table.body.rows.map { $0.cells.map(children(of:)) },
                        alignments: table.columnAlignments.map { $0.map(ColumnAlignment.init) }),
                    sourceRange: range)
            ]
        case is ThematicBreak:
            return [Block(.thematicBreak, sourceRange: range)]
        default:
            return []
        }
    }

    /// A paragraph's images are blocks of their own — an embed stands on its
    /// own line, and the model has no inline image — so a paragraph splits
    /// around each: the runs of text between them are paragraphs, one that
    /// is only line breaks or whitespace dropped.
    private func blocks(of paragraph: Paragraph, within range: Range<Int>) -> [Block] {
        let children = Array(paragraph.children)
        guard children.contains(where: { $0 is Markdown.Image }) else {
            return [Block(.paragraph(self.children(of: paragraph)), sourceRange: range)]
        }
        var blocks: [Block] = []
        var run: [Markup] = []
        func flushRun() {
            if let paragraph = self.paragraph(of: run, within: range) { blocks.append(paragraph) }
            run = []
        }
        for child in children {
            if let image = child as? Markdown.Image {
                flushRun()
                blocks.append(
                    Block(self.image(image), sourceRange: prePass.sourceRange(of: image, within: range)))
            } else {
                run.append(child)
            }
        }
        flushRun()
        return blocks
    }

    /// A run's range spans its first and last node that has one: a line
    /// break has none, and would otherwise stand for the whole paragraph.
    private func paragraph(of run: [Markup], within range: Range<Int>) -> Block? {
        let content = run.flatMap { inlines(of: $0) }.trimmed
        let located = run.filter { $0.range != nil }
        guard !content.isEmpty, let first = located.first, let last = located.last else {
            return nil
        }
        let lower = prePass.sourceRange(of: first, within: range).lowerBound
        let upper = prePass.sourceRange(of: last, within: range).upperBound
        return Block(.paragraph(content), sourceRange: lower..<upper)
    }

    /// An image's source: the attachment an embed or a relative Markdown
    /// image names, or a URL kept as written.
    private func image(_ image: Markdown.Image) -> Block.Kind {
        let source = image.source ?? ""
        let path: String
        let width: Int?
        if case .attachment(let embedded, let embedWidth) = VitrineDestination(source) {
            path = embedded
            width = embedWidth
        } else {
            path = source.removingPercentEncoding ?? source
            width = nil
        }
        return .image(
            source: MarkdownLink.hasURLScheme(path) ? .external(path) : .attachment(path),
            alt: image.plainText, width: width)
    }

    /// A list whose every item has a checkbox is a task list; one that mixes
    /// checkboxes with plain items is a plain list, its checkboxes not drawn.
    private func list(_ list: ListItemContainer, isOrdered: Bool, start: Int, within range: Range<Int>)
        -> Block.Kind
    {
        let items = Array(list.listItems)
        let blocks = items.map { item in
            children(of: item, within: prePass.sourceRange(of: item, within: range))
        }
        let checkboxes = items.compactMap(\.checkbox)
        guard checkboxes.count == items.count else {
            return .list(isOrdered: isOrdered, start: start, items: blocks)
        }
        return .taskList(
            items: zip(checkboxes, blocks).map { checkbox, blocks in
                TaskItem(isChecked: checkbox == .checked, blocks: blocks)
            })
    }

    // MARK: - Inlines

    /// A link is a wikilink or a tag when the pre-pass wrote its
    /// destination; otherwise the note's own, a URL kept as written and a
    /// path percent-decoded, as the parser reads a Markdown link.
    private func link(_ link: Markdown.Link) -> Inline {
        let destination = link.destination ?? ""
        switch VitrineDestination(destination) {
        case .note(let target):
            return .wikilink(target: target, inlines: children(of: link))
        case .tag(let name):
            return .tag(name)
        case .attachment, nil:
            let isExternal = MarkdownLink.hasURLScheme(destination)
            return .link(
                destination: isExternal
                    ? destination : destination.removingPercentEncoding ?? destination,
                inlines: children(of: link))
        }
    }

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
        case let strong as Strong:
            return [.strong(children(of: strong))]
        case let code as InlineCode:
            return [.code(code.code)]
        case let strikethrough as Strikethrough:
            return [.strikethrough(children(of: strikethrough))]
        case let link as Markdown.Link:
            return [self.link(link)]
        case is SoftBreak:
            return [.softBreak]
        case is LineBreak:
            return [.lineBreak]
        default:
            return []
        }
    }
}

extension [Inline] {
    /// The run without the breaks and whitespace at either end, which a
    /// paragraph split around an image would otherwise begin or end with.
    fileprivate var trimmed: [Inline] {
        var inlines = self[...]
        while let first = inlines.first, first.isBlank { inlines = inlines.dropFirst() }
        while let last = inlines.last, last.isBlank { inlines = inlines.dropLast() }
        if case .text(let text) = inlines.first {
            inlines[inlines.startIndex] = .text(String(text.drop(while: \.isWhitespace)))
        }
        if case .text(let text) = inlines.last {
            inlines[inlines.endIndex - 1] = .text(
                String(text.reversed().drop(while: \.isWhitespace).reversed()))
        }
        return Array(inlines)
    }
}

extension Inline {
    fileprivate var isBlank: Bool {
        switch self {
        case .softBreak, .lineBreak: true
        case .text(let text): text.allSatisfy(\.isWhitespace)
        default: false
        }
    }
}

extension String {
    /// cmark reports a code block's every line with its ending, the last
    /// included; the block's text is the lines between the fences.
    fileprivate var trimmingTrailingNewline: String {
        hasSuffix("\n") ? String(dropLast()) : self
    }

    /// A fence's info string is `swift title=x`; the language is its first
    /// word (CommonMark § 4.5).
    fileprivate var firstWord: String? {
        split(whereSeparator: \.isWhitespace).first.map(String.init)
    }
}

extension ColumnAlignment {
    fileprivate init(_ alignment: Table.ColumnAlignment) {
        switch alignment {
        case .left: self = .left
        case .center: self = .center
        case .right: self = .right
        }
    }
}
