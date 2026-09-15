import NoteParsing
import Rendering
import Testing

@Suite struct RenderingTests {
    // MARK: - Blocks

    @Test func headings_carry_their_level_and_inlines() {
        let text = """
            # One
            ## Two
            ### Three
            #### Four
            ##### Five
            ###### Six *six*
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(.heading(level: 1, inlines: [.text("One")]), sourceRange: 0..<5),
                Block(.heading(level: 2, inlines: [.text("Two")]), sourceRange: 6..<12),
                Block(.heading(level: 3, inlines: [.text("Three")]), sourceRange: 13..<22),
                Block(.heading(level: 4, inlines: [.text("Four")]), sourceRange: 23..<32),
                Block(.heading(level: 5, inlines: [.text("Five")]), sourceRange: 33..<43),
                Block(
                    .heading(level: 6, inlines: [.text("Six "), .emphasis([.text("six")])]),
                    sourceRange: 44..<60),
            ])
    }

    @Test func a_paragraph_carries_emphasis_strong_code_strikethrough_and_breaks() {
        let text = """
            Plain *em* **strong** `code` ~~gone~~
            soft  
            hard
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .paragraph([
                        .text("Plain "), .emphasis([.text("em")]), .text(" "),
                        .strong([.text("strong")]), .text(" "), .code("code"), .text(" "),
                        .strikethrough([.text("gone")]), .softBreak, .text("soft"), .lineBreak,
                        .text("hard"),
                    ]),
                    sourceRange: 0..<49)
            ])
    }

    @Test func lists_nest_and_an_ordered_list_keeps_its_start() {
        let text = """
            - a
            - b
              1. c
              2. d

            3. e
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .list(
                        isOrdered: false, start: 1,
                        items: [
                            [Block(.paragraph([.text("a")]), sourceRange: 2..<3)],
                            [
                                Block(.paragraph([.text("b")]), sourceRange: 6..<7),
                                Block(
                                    .list(
                                        isOrdered: true, start: 1,
                                        items: [
                                            [Block(.paragraph([.text("c")]), sourceRange: 13..<14)],
                                            [Block(.paragraph([.text("d")]), sourceRange: 20..<21)],
                                        ]),
                                    sourceRange: 10..<21),
                            ],
                        ]),
                    sourceRange: 0..<21),
                Block(
                    .list(
                        isOrdered: true, start: 3,
                        items: [[Block(.paragraph([.text("e")]), sourceRange: 26..<27)]]),
                    sourceRange: 23..<27),
            ])
    }

    @Test func a_task_list_carries_each_items_checked_state() {
        let text = """
            - [x] done
            - [ ] todo
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .taskList(items: [
                        TaskItem(
                            isChecked: true,
                            blocks: [Block(.paragraph([.text("done")]), sourceRange: 6..<10)]),
                        TaskItem(
                            isChecked: false,
                            blocks: [Block(.paragraph([.text("todo")]), sourceRange: 17..<21)]),
                    ]),
                    sourceRange: 0..<21)
            ])
    }

    @Test func a_fenced_code_block_keeps_its_language_and_text_whichever_fence() {
        let text = """
            ```swift
            let x = 1
            ```

            ~~~
            tilde
            ~~~

            ```python title=x
            y
            ```
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(.codeBlock(language: "swift", text: "let x = 1"), sourceRange: 0..<22),
                Block(.codeBlock(language: nil, text: "tilde"), sourceRange: 24..<37),
                Block(.codeBlock(language: "python", text: "y"), sourceRange: 39..<62),
            ])
    }

    @Test func a_block_quote_contains_blocks() {
        let text = """
            > Quoted *text*
            >
            > - item
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .quote([
                        Block(
                            .paragraph([.text("Quoted "), .emphasis([.text("text")])]),
                            sourceRange: 2..<15),
                        Block(
                            .list(
                                isOrdered: false, start: 1,
                                items: [[Block(.paragraph([.text("item")]), sourceRange: 22..<26)]]),
                            sourceRange: 20..<26),
                    ]),
                    sourceRange: 0..<26)
            ])
    }

    @Test func a_table_carries_its_header_rows_and_column_alignments() {
        let text = """
            | Left | Center | Right | None |
            |:-----|:------:|------:|------|
            | 1 | *2* | 3 | 4 |
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .table(
                        header: [[.text("Left")], [.text("Center")], [.text("Right")], [.text("None")]],
                        rows: [[[.text("1")], [.emphasis([.text("2")])], [.text("3")], [.text("4")]]],
                        alignments: [.left, .center, .right, nil]),
                    sourceRange: 0..<85)
            ])
    }

    @Test func a_thematic_break_in_the_body_is_a_block() {
        let text = """
            Above

            ---

            Below
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(.paragraph([.text("Above")]), sourceRange: 0..<5),
                Block(.thematicBreak, sourceRange: 7..<10),
                Block(.paragraph([.text("Below")]), sourceRange: 12..<17),
            ])
    }

    // MARK: - Wikilinks, embeds, and tags

    @Test func a_wikilink_shows_its_target_or_its_display_text_and_drops_a_fragment() {
        let text = "See [[Note]], [[Note|shown]], and [[Note#Heading]]."

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .paragraph([
                        .text("See "), .wikilink(target: "Note", inlines: [.text("Note")]),
                        .text(", "), .wikilink(target: "Note", inlines: [.text("shown")]),
                        .text(", and "), .wikilink(target: "Note", inlines: [.text("Note")]),
                        .text("."),
                    ]),
                    sourceRange: 0..<51)
            ])
    }

    @Test func a_wikilink_keeps_emphasis_in_its_shown_text() {
        let text = "[[a *b* c]]"

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .paragraph([
                        .wikilink(
                            target: "a *b* c",
                            inlines: [.text("a "), .emphasis([.text("b")]), .text(" c")])
                    ]),
                    sourceRange: 0..<11)
            ])
    }

    @Test func a_reference_definition_elsewhere_does_not_hijack_a_wikilink() {
        let text = """
            [[a]]

            [a]: https://example.com
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .paragraph([.wikilink(target: "a", inlines: [.text("a")])]), sourceRange: 0..<5)
            ])
    }

    @Test func a_hash_with_a_space_is_a_heading_and_without_one_a_tag_run() {
        let text = """
            # Heading
            #tag and #nested/tag.
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(.heading(level: 1, inlines: [.text("Heading")]), sourceRange: 0..<9),
                Block(
                    .paragraph([.tag("tag"), .text(" and "), .tag("nested/tag"), .text(".")]),
                    sourceRange: 10..<31),
            ])
    }

    @Test func an_embed_and_a_markdown_image_are_image_blocks_by_their_source() {
        let text = """
            ![[img.png|800]]

            ![alt](My%20Image.png)

            ![remote](https://example.com/x.png)
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(
                    .image(source: .attachment("img.png"), alt: "", width: 800), sourceRange: 0..<16),
                Block(
                    .image(source: .attachment("My Image.png"), alt: "alt", width: nil),
                    sourceRange: 18..<40),
                Block(
                    .image(source: .external("https://example.com/x.png"), alt: "remote", width: nil),
                    sourceRange: 42..<78),
            ])
    }

    @Test func an_image_within_a_paragraph_splits_it_around_the_image() {
        let text = """
            Before ![[a.png]]
            after
            """

        let blocks = render(text)

        #expect(
            blocks == [
                Block(.paragraph([.text("Before")]), sourceRange: 0..<6),
                Block(.image(source: .attachment("a.png"), alt: "", width: nil), sourceRange: 7..<17),
                Block(.paragraph([.text("after")]), sourceRange: 18..<23),
            ])
    }

    // MARK: - Helpers

    private func render(_ text: String) -> [Block] {
        RenderedNote.render(ParsedNote.parse(text))
    }

    private func slice(_ text: String, _ range: Range<Int>) -> String {
        String(decoding: Array(text.utf8)[range], as: UTF8.self)
    }
}
