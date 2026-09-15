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

    // MARK: - Helpers

    private func render(_ text: String) -> [Block] {
        RenderedNote.render(ParsedNote.parse(text))
    }

    private func slice(_ text: String, _ range: Range<Int>) -> String {
        String(decoding: Array(text.utf8)[range], as: UTF8.self)
    }
}
