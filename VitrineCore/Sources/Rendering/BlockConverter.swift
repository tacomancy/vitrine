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
        case let paragraph as Paragraph:
            return [Block(.paragraph(children(of: paragraph)), sourceRange: range)]
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
        case is SoftBreak:
            return [.softBreak]
        case is LineBreak:
            return [.lineBreak]
        default:
            return []
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
