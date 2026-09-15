import NoteParsing
import Testing

@Suite struct NoteParsingTests {
    // MARK: - Frontmatter placement

    @Test func three_dashes_on_line_1_closed_by_a_later_line_of_three_dashes_is_frontmatter() {
        let note = ParsedNote.parse(
            """
            ---
            tags: [a]
            ---
            Body
            """)

        #expect(note.frontmatter != nil)
    }

    @Test func three_dashes_first_appearing_after_line_1_is_body() {
        let note = ParsedNote.parse(
            """
            Intro
            ---
            tags: [a]
            ---
            """)

        #expect(note.frontmatter == nil)
    }

    @Test func an_unclosed_block_is_body() {
        let note = ParsedNote.parse(
            """
            ---
            tags: [a]
            Body
            """)

        #expect(note.frontmatter == nil)
    }

    @Test func frontmatter_is_recognised_in_a_file_with_windows_line_endings() {
        let text = "---\r\ntags: [a]\r\n---\r\nBody"

        let note = ParsedNote.parse(text)

        #expect(note.frontmatter?.tags == ["a"])
        #expect(note.frontmatter.map { slice(text, $0.rawRange) } == "---\r\ntags: [a]\r\n---")
        #expect(slice(text, note.bodyRange) == "Body")
    }

    @Test func rawRange_covers_the_block_including_both_delimiters_as_written() {
        let text = """
            ---
            tags:  [a]   # spacing kept
            ---
            Body
            """

        let note = ParsedNote.parse(text)

        #expect(note.frontmatter?.rawRange == 0..<35)
        #expect(slice(text, 0..<35) == "---\ntags:  [a]   # spacing kept\n---")
    }

    // MARK: - Frontmatter keys

    /// Every form Obsidian accepts under `tags:`, each with the tags it means.
    private static let tagForms: [(yaml: String, tags: [String])] = [
        ("tags:\n  - alpha\n  - beta", ["alpha", "beta"]),  // block list
        ("tags: [alpha, beta]", ["alpha", "beta"]),  // flow list
        ("tags: alpha", ["alpha"]),  // single string
        ("tags: alpha, beta", ["alpha", "beta"]),  // comma-separated string
    ]

    @Test(arguments: tagForms)
    func tags_as_a_block_list_flow_list_string_or_comma_separated_string_yield_the_same_tags(
        form: (yaml: String, tags: [String])
    ) {
        let note = ParsedNote.parse("---\n\(form.yaml)\n---\n")

        #expect(note.frontmatter?.tags == form.tags)
    }

    @Test func the_singular_tag_key_yields_tags_too() {
        let note = ParsedNote.parse("---\ntag: [alpha, beta]\n---\n")

        #expect(note.frontmatter?.tags == ["alpha", "beta"])
    }

    @Test func a_leading_hash_in_a_frontmatter_tag_is_stripped() {
        let note = ParsedNote.parse("---\ntags:\n  - \"#alpha\"\n  - beta\n---\n")

        #expect(note.frontmatter?.tags == ["alpha", "beta"])
    }

    @Test func frontmatter_tags_are_in_the_order_written() {
        let note = ParsedNote.parse("---\ntags: [zeta, Alpha, mid]\n---\n")

        #expect(note.frontmatter?.tags == ["zeta", "Alpha", "mid"])
    }

    @Test func a_frontmatter_value_that_fails_the_tag_grammar_is_not_a_tag() {
        // Obsidian marks `2026` and `two words` invalid and lists neither.
        let note = ParsedNote.parse("---\ntags: [ok, \"2026\", \"two words\"]\n---\n")

        #expect(note.frontmatter?.tags == ["ok"])
    }

    @Test func the_leading_hash_is_stripped_before_the_tag_grammar_applies() {
        let note = ParsedNote.parse("---\ntags: [\"#2026\"]\n---\n")

        #expect(note.frontmatter?.tags == [])
    }

    @Test func the_tag_grammar_applies_to_each_value_of_a_comma_separated_string_too() {
        let note = ParsedNote.parse("---\ntag: \"keep, 1984, y1984\"\n---\n")

        #expect(note.frontmatter?.tags == ["keep", "y1984"])
    }

    @Test func an_alias_is_not_a_tag_so_the_tag_grammar_does_not_apply_to_aliases() {
        let note = ParsedNote.parse("---\naliases: [\"two words\", \"1984\"]\n---\n")

        #expect(note.frontmatter?.aliases == ["two words", "1984"])
    }

    /// The same forms under `aliases:`, and the singular `alias:`.
    private static let aliasForms: [(yaml: String, aliases: [String])] = [
        ("aliases:\n  - Start here\n  - Home", ["Start here", "Home"]),
        ("aliases: [Start here, Home]", ["Start here", "Home"]),
        ("aliases: Start here", ["Start here"]),
        ("aliases: Start here, Home", ["Start here", "Home"]),
        ("alias: Home", ["Home"]),
    ]

    @Test(arguments: aliasForms)
    func aliases_and_alias_yield_aliases_in_the_same_forms(
        form: (yaml: String, aliases: [String])
    ) {
        let note = ParsedNote.parse("---\n\(form.yaml)\n---\n")

        #expect(note.frontmatter?.aliases == form.aliases)
    }

    @Test func invalid_yaml_in_the_block_yields_no_frontmatter_and_the_full_text_as_body() {
        let text = "---\ntags: [unclosed\n---\nBody #tag\n"

        let note = ParsedNote.parse(text)

        #expect(note.frontmatter == nil)
        #expect(note.bodyRange == 0..<text.utf8.count)
    }

    @Test func values_are_read_as_strings_so_yes_and_no_are_tags_not_booleans() {
        let note = ParsedNote.parse("---\ntags: [yes, no]\n---\n")

        #expect(note.frontmatter?.tags == ["yes", "no"])
    }

    @Test func bodyRange_starts_on_the_line_after_the_frontmatter() {
        let note = ParsedNote.parse("---\ntags: [a]\n---\nBody")

        #expect(note.bodyRange == 18..<22)
    }

    @Test func bodyRange_starts_at_0_when_there_is_no_frontmatter() {
        let note = ParsedNote.parse("Body")

        #expect(note.bodyRange == 0..<4)
    }

    // MARK: - Body tags

    @Test func a_body_tag_counts_at_start_of_line_or_after_whitespace_but_not_inside_a_url() {
        let text = "#first line\nsee https://example.com/#frag and #second\tand #third"

        let note = ParsedNote.parse(text)

        #expect(
            note.bodyTags == [
                Tag(name: "first", range: 0..<6),
                Tag(name: "second", range: 46..<53),
                Tag(name: "third", range: 58..<64),
            ])
        #expect(slice(text, 46..<53) == "#second")
    }

    @Test func a_tag_is_letters_digits_underscore_dash_and_slash_without_trailing_punctuation() {
        let note = ParsedNote.parse("#tag. #snake_case, #kebab-case; #v2! #trailing-/")

        #expect(
            note.bodyTags.map(\.name) == ["tag", "snake_case", "kebab-case", "v2", "trailing"])
        #expect(note.bodyTags.map(\.range) == [0..<4, 6..<17, 19..<30, 32..<35, 37..<46])
    }

    @Test func an_all_digit_token_is_not_a_tag() {
        let note = ParsedNote.parse("#1 #2026 #1a")

        #expect(note.bodyTags.map(\.name) == ["1a"])
    }

    @Test func a_digit_is_a_decimal_digit_in_any_script_and_a_numeral_letter_is_not_one() {
        // U+0663 is an Arabic-Indic digit; 三 is a letter that happens to be a numeral.
        let note = ParsedNote.parse("#\u{0663} #三")

        #expect(note.bodyTags.map(\.name) == ["三"])
    }

    @Test func parent_slash_child_is_one_tag_with_that_name() {
        let note = ParsedNote.parse("#parent/child")

        #expect(note.bodyTags == [Tag(name: "parent/child", range: 0..<13)])
    }

    @Test func bodyTags_are_in_order_of_appearance_and_not_deduplicated() {
        let note = ParsedNote.parse("#a #A #a")

        #expect(note.bodyTags.map(\.name) == ["a", "A", "a"])
    }

    // MARK: - Skipped contexts

    @Test func nothing_inside_a_fenced_block_is_a_tag_or_link() {
        let note = ParsedNote.parse(
            """
            #before
            ```python
            # comment #notatag [[Not a link]]
            ```
            ~~~~
            #notatag
            ```
            #still-in-the-tilde-fence
            ~~~~
            #after
            """)

        #expect(note.bodyTags.map(\.name) == ["before", "after"])
        #expect(note.links.isEmpty)
    }

    @Test func nothing_inside_inline_code_is_a_tag_or_link() {
        let note = ParsedNote.parse("Use `code #notatag` and `` [[Not a link]] `` but #tag")

        #expect(note.bodyTags.map(\.name) == ["tag"])
        #expect(note.links.isEmpty)
    }

    @Test func nothing_inside_an_html_tag_is_a_tag() {
        // Obsidian counts the hex color; Vitrine deliberately does not
        // (CONTEXT.md § Tags, the one recorded divergence).
        let note = ParsedNote.parse("<mark style=\"background: #FFF3A3A6;\">text</mark> #tag")

        #expect(note.bodyTags.map(\.name) == ["tag"])
    }

    @Test func nothing_inside_an_html_comment_is_a_tag() {
        let note = ParsedNote.parse("<!-- #notatag --> #tag")

        #expect(note.bodyTags.map(\.name) == ["tag"])
    }

    @Test func an_unclosed_delimiter_is_literal_text_and_scanning_continues_after_it() {
        let note = ParsedNote.parse(
            """
            `unclosed code #one
            a <b #two
            c > d #three
            [[unclosed #four
            [text without destination] #five
            ```
            #notatag in an unclosed fence
            """)

        #expect(note.bodyTags.map(\.name) == ["one", "two", "three", "four", "five"])
        #expect(note.links.isEmpty)
    }

    // MARK: - Links

    @Test func a_wikilink_has_its_target_and_an_optional_display_text() {
        let text = "See [[Note]] or [[Note|shown]]."

        let note = ParsedNote.parse(text)

        #expect(
            note.links == [
                .wikilink(Wikilink(target: "Note", displayText: nil, range: 4..<12)),
                .wikilink(Wikilink(target: "Note", displayText: "shown", range: 16..<30)),
            ])
        #expect(slice(text, 16..<30) == "[[Note|shown]]")
    }

    @Test func a_heading_or_block_fragment_is_dropped_from_a_wikilink_target() {
        let note = ParsedNote.parse("[[Note#Heading]] [[Note#^block]] [[Note#Heading|shown]]")

        #expect(
            note.links == [
                .wikilink(Wikilink(target: "Note", displayText: nil, range: 0..<16)),
                .wikilink(Wikilink(target: "Note", displayText: nil, range: 17..<32)),
                .wikilink(Wikilink(target: "Note", displayText: "shown", range: 33..<55)),
            ])
    }

    @Test func an_escaped_pipe_in_a_table_cell_ends_the_target_without_the_backslash() {
        let text = "| [[C1_W2_Linear_Regression.ipynb\\|Linear Regression]] |"

        let note = ParsedNote.parse(text)

        #expect(
            note.links == [
                .wikilink(
                    Wikilink(
                        target: "C1_W2_Linear_Regression.ipynb", displayText: "Linear Regression",
                        range: 2..<54))
            ])
        #expect(slice(text, 2..<54) == "[[C1_W2_Linear_Regression.ipynb\\|Linear Regression]]")
    }

    @Test func a_fragment_marker_in_the_display_text_does_not_end_the_target() {
        let note = ParsedNote.parse("[[Note|see #3]] [[Note|the ^ key]]")

        #expect(
            note.links == [
                .wikilink(Wikilink(target: "Note", displayText: "see #3", range: 0..<15)),
                .wikilink(Wikilink(target: "Note", displayText: "the ^ key", range: 16..<34)),
            ])
    }

    @Test func a_wikilink_target_is_trimmed() {
        let note = ParsedNote.parse("[[ Note ]]")

        #expect(
            note.links == [.wikilink(Wikilink(target: "Note", displayText: nil, range: 0..<10))])
    }

    @Test func a_wikilink_with_no_target_is_not_a_link_to_a_note() {
        // `[[#Heading]]` points into this note; heading links are parked (BACKLOG).
        let note = ParsedNote.parse("[[]] [[ ]] [[#Heading]] [[|shown]] ![[]]")

        #expect(note.links.isEmpty)
        #expect(note.embeds.isEmpty)
    }

    @Test func a_markdown_link_to_a_path_has_its_destination_percent_decoded_and_is_not_external() {
        let text = "Read [shown](My%20Note.md) next."

        let note = ParsedNote.parse(text)

        #expect(
            note.links == [
                .markdown(
                    MarkdownLink(
                        destination: "My Note.md", displayText: "shown", isExternal: false,
                        range: 5..<26))
            ])
        #expect(slice(text, 5..<26) == "[shown](My%20Note.md)")
    }

    @Test func a_markdown_link_is_external_when_its_destination_has_a_url_scheme() {
        let note = ParsedNote.parse("[shown](https://example.com) [plain](Note.md)")

        #expect(
            note.links == [
                .markdown(
                    MarkdownLink(
                        destination: "https://example.com", displayText: "shown",
                        isExternal: true, range: 0..<28)),
                .markdown(
                    MarkdownLink(
                        destination: "Note.md", displayText: "plain", isExternal: false,
                        range: 29..<45)),
            ])
    }

    @Test func an_external_markdown_link_keeps_its_destination_as_written() {
        let note = ParsedNote.parse("[shown](https://example.com/a%20b?q=1%262#frag)")

        #expect(
            note.links == [
                .markdown(
                    MarkdownLink(
                        destination: "https://example.com/a%20b?q=1%262#frag", displayText: "shown",
                        isExternal: true, range: 0..<47))
            ])
    }

    @Test func an_embed_of_a_url_keeps_its_destination_as_written() {
        let note = ParsedNote.parse("![alt](https://example.com/a%20b.png)")

        #expect(note.embeds == [Embed(filename: "https://example.com/a%20b.png", range: 0..<37)])
    }

    @Test func a_markdown_link_destination_may_contain_balanced_parentheses() {
        let note = ParsedNote.parse("[shown](Notes/Paper%20(2019).md) tail")

        #expect(
            note.links == [
                .markdown(
                    MarkdownLink(
                        destination: "Notes/Paper (2019).md", displayText: "shown",
                        isExternal: false, range: 0..<32))
            ])
    }

    // MARK: - Frontmatter links

    @Test func a_wikilink_in_a_scalar_frontmatter_value_is_a_link_with_a_range_into_the_block() {
        let text = "---\nsource: \"[[Note]]\"\n---\n"

        let note = ParsedNote.parse(text)

        #expect(
            note.links == [
                .wikilink(
                    Wikilink(
                        target: "Note", displayText: nil, range: 13..<21, isFromFrontmatter: true))
            ])
        #expect(slice(text, 13..<21) == "[[Note]]")
        #expect(note.links.map(\.isFromFrontmatter) == [true])
    }

    @Test func wikilinks_in_a_frontmatter_list_are_links_in_the_order_written() {
        let text = "---\nsources:\n  - \"[[First]]\"\n  - \"[[Second]]\"\n---\n"

        let note = ParsedNote.parse(text)

        #expect(
            note.links == [
                .wikilink(
                    Wikilink(
                        target: "First", displayText: nil, range: 18..<27, isFromFrontmatter: true)),
                .wikilink(
                    Wikilink(
                        target: "Second", displayText: nil, range: 34..<44, isFromFrontmatter: true)
                ),
            ])
        #expect(note.links.map { slice(text, $0.range) } == ["[[First]]", "[[Second]]"])
    }

    @Test func wikilinks_are_found_under_any_frontmatter_key_at_any_depth() {
        let text = "---\nrelated: \"[[A]]\"\nmeta:\n  cites: [\"[[B]]\"]\n---\n"

        let note = ParsedNote.parse(text)

        #expect(note.links.map { slice(text, $0.range) } == ["[[A]]", "[[B]]"])
        #expect(note.links.map(\.isFromFrontmatter) == [true, true])
    }

    @Test func a_frontmatter_wikilink_keeps_its_display_text() {
        let text = "---\nsource: \"[[Note|shown]]\"\n---\n"

        let note = ParsedNote.parse(text)

        #expect(
            note.links == [
                .wikilink(
                    Wikilink(
                        target: "Note", displayText: "shown", range: 13..<27,
                        isFromFrontmatter: true))
            ])
    }

    @Test func a_markdown_link_and_a_tag_in_a_frontmatter_value_are_not_recognised() {
        // Obsidian reads neither out of a property value.
        let note = ParsedNote.parse("---\nsource: \"[shown](Note.md) #tag\"\n---\n")

        #expect(note.links.isEmpty)
        #expect(note.bodyTags.isEmpty)
        #expect(note.frontmatter?.tags == [])
    }

    // MARK: - Embeds

    @Test func an_embed_names_its_file_with_any_width_dropped() {
        let text = "![[image.png|800]] and ![alt](photo%201.jpg)"

        let note = ParsedNote.parse(text)

        #expect(
            note.embeds == [
                Embed(filename: "image.png", range: 0..<18),
                Embed(filename: "photo 1.jpg", range: 23..<44),
            ])
        #expect(slice(text, 23..<44) == "![alt](photo%201.jpg)")
        #expect(note.links.isEmpty)
    }

    @Test func an_escaped_pipe_in_a_table_cell_ends_an_embeds_filename_without_the_backslash() {
        let text = "| ![[image.png\\|300]] |"

        let note = ParsedNote.parse(text)

        #expect(note.embeds == [Embed(filename: "image.png", range: 2..<21)])
        #expect(slice(text, 2..<21) == "![[image.png\\|300]]")
    }

    // MARK: - Ranges

    @Test func a_parsed_note_carries_the_text_its_ranges_point_into() {
        let text = "---\ntags: [a]\n---\nBody #tag\n"

        let note = ParsedNote.parse(text)

        #expect(note.text == text)
        #expect(note.bodyTags.map { slice(note.text, $0.range) } == ["#tag"])
    }

    @Test func every_tokens_range_points_at_exactly_its_text_in_the_input() {
        let text = """
            ---
            tags: [a]
            ---
            Ünïcödé before #tag and [[Nöte|shown]] then [lïnk](Nöte%20Two.md) and ![[ïmage.png|300]].
            """

        let note = ParsedNote.parse(text)

        #expect(note.bodyTags.map { slice(text, $0.range) } == ["#tag"])
        #expect(
            note.links.map { slice(text, $0.range) } == ["[[Nöte|shown]]", "[lïnk](Nöte%20Two.md)"])
        #expect(note.embeds.map { slice(text, $0.range) } == ["![[ïmage.png|300]]"])
        #expect(note.frontmatter.map { slice(text, $0.rawRange) } == "---\ntags: [a]\n---")
        #expect(
            slice(text, note.bodyRange)
                == "Ünïcödé before #tag and [[Nöte|shown]] then [lïnk](Nöte%20Two.md) and ![[ïmage.png|300]]."
        )
    }

    // MARK: - Structure

    @Test func an_atx_heading_yields_its_level_and_the_range_of_the_whole_line() {
        let text = """
            # H1
            ## H2 with #tag
            ###### H6
            ####### seven is text
            #tag at line start
            #
            """

        let note = ParsedNote.parse(text)

        #expect(note.structure.headings.map(\.level) == [1, 2, 6])
        #expect(
            note.structure.headings.map { slice(text, $0.range) } == [
                "# H1", "## H2 with #tag", "###### H6",
            ])
        #expect(note.bodyTags.map(\.name) == ["tag", "tag"])
    }

    @Test func a_fenced_block_in_either_fence_character_covers_both_fences() {
        let text = """
            Before
            ```python
            # not a heading #notatag
            ```
            ~~~
            ```
            ~~~
            After
            ````
            unclosed
            """

        let note = ParsedNote.parse(text)

        #expect(
            note.structure.fencedCodeBlocks.map { slice(text, $0) } == [
                "```python\n# not a heading #notatag\n```",
                "~~~\n```\n~~~",
                "````\nunclosed",
            ])
        #expect(note.structure.headings.isEmpty)
        #expect(note.bodyTags.isEmpty)
    }

    @Test func an_inline_code_span_covers_its_backticks_and_hides_links_and_tags() {
        let text = "Use `code #notatag` and `` [[Not a link]] `` but `unclosed #tag"

        let note = ParsedNote.parse(text)

        #expect(
            note.structure.inlineCodeSpans.map { slice(text, $0) } == [
                "`code #notatag`", "`` [[Not a link]] ``",
            ])
        #expect(note.bodyTags.map(\.name) == ["tag"])
        #expect(note.links.isEmpty)
    }

    @Test func every_structure_range_points_at_exactly_its_text_whatever_the_line_ending() {
        let text = "---\r\ntags: [a]\r\n---\r\n## Ünïcödé\r\n```\r\ncöde\r\n```\r\n`spän` #tag\r\n"

        let note = ParsedNote.parse(text)

        #expect(note.structure.headings.map { slice(text, $0.range) } == ["## Ünïcödé"])
        #expect(note.structure.fencedCodeBlocks.map { slice(text, $0) } == ["```\r\ncöde\r\n```"])
        #expect(note.structure.inlineCodeSpans.map { slice(text, $0) } == ["`spän`"])
        #expect(note.bodyTags.map { slice(text, $0.range) } == ["#tag"])
    }

    // MARK: - Helpers

    /// The text a UTF-8 offset range points at — every token's range must
    /// slice the input to exactly its own text.
    private func slice(_ text: String, _ range: Range<Int>) -> String {
        String(decoding: Array(text.utf8)[range], as: UTF8.self)
    }
}
