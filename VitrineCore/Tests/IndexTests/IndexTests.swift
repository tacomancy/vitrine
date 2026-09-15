import Fixtures
import Foundation
import Index
import Library
import NoteParsing
import Testing

@Suite struct IndexTests {
    @Test func tags_of_a_note_deduplicate_case_insensitively_with_frontmatter_first() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try #require(library.allNotes.first { $0.path == "Topics/Alignment.md" })

        // Frontmatter: Alignment, interp/saes; body: #alignment (a repeat), #interp/circuits.
        #expect(index.tags(of: alignment) == ["Alignment", "interp/saes", "interp/circuits"])
    }

    @Test func a_segments_display_spelling_is_the_first_seen_in_library_display_order() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let interpretability = try #require(
            library.allNotes.first { $0.path == "Topics/Interpretability.md" })
        let eveningJournal = try #require(library.allNotes.first { $0.path == "Topics/Journal.md" })

        // Written `Interp/SAEs/dictionary` and `#Reading/Notes`, but `interp/saes`
        // was seen first in Topics/Alignment and `#reading/paper` in Reading List.
        #expect(index.tags(of: interpretability) == ["interp/saes/dictionary", "reading/Notes"])
        // Written `#Daily`; `#daily` came first in Daily/.
        #expect(index.tags(of: eveningJournal) == ["daily"])
    }

    @Test func the_tag_tree_nests_each_segment_under_its_parent() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        // No note carries a bare #interp; the node exists for its descendants.
        let interp = try #require(index.tagTree.first { $0.path == "interp" })
        #expect(interp.name == "interp")
        #expect(interp.children.map(\.path) == ["interp/circuits", "interp/saes"])
        let saes = try #require(interp.children.first { $0.path == "interp/saes" })
        #expect(saes.name == "saes")
        #expect(saes.children.map(\.name) == ["dictionary"])
        #expect(saes.children.map(\.path) == ["interp/saes/dictionary"])
        #expect(saes.children.flatMap(\.children).isEmpty)
    }

    @Test func a_nodes_count_is_the_notes_carrying_it_or_any_descendant_each_once() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        // Alignment carries both interp/saes and interp/circuits; Interpretability
        // carries interp/saes/dictionary. Two notes under interp, not three.
        let interp = try #require(index.tagTree.first { $0.path == "interp" })
        #expect(interp.count == 2)
        #expect(interp.children.map(\.count) == [1, 2])
        let saes = try #require(interp.children.first { $0.path == "interp/saes" })
        #expect(saes.children.map(\.count) == [1])
        // #daily in Daily/2026-09-13 and Daily/Journal, #Daily in Topics/Journal.
        let daily = try #require(index.tagTree.first { $0.path == "daily" })
        #expect(daily.count == 3)
    }

    @Test func siblings_sort_case_insensitively_by_display_name_at_every_level() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        // `agents` before `Alignment`: ASCII would put the capital first.
        #expect(
            index.tagTree.map(\.name) == [
                "agents", "Alignment", "daily", "fixture", "interp", "project", "reading",
                "vitrine",
            ])
        let reading = try #require(index.tagTree.first { $0.path == "reading" })
        #expect(reading.children.map(\.name) == ["Notes", "paper"])
    }

    @Test func notes_tagged_returns_carriers_of_the_tag_or_any_descendant_in_display_order()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        #expect(
            index.notes(tagged: "daily").map(\.path) == [
                "Daily/2026-09-13.md", "Daily/Journal.md", "Topics/Journal.md",
            ])
        // Neither note carries a bare interp; both carry a tag under it.
        #expect(
            index.notes(tagged: "interp").map(\.path) == [
                "Topics/Alignment.md", "Topics/Interpretability.md",
            ])
        #expect(
            index.notes(tagged: "interp/saes/dictionary").map(\.path) == [
                "Topics/Interpretability.md"
            ])
        // The identity is case-insensitive, like the tag.
        #expect(index.notes(tagged: "Reading/NOTES").map(\.path) == ["Topics/Interpretability.md"])
        #expect(index.notes(tagged: "nowhere").isEmpty)
    }

    @Test func untagged_is_exactly_the_notes_with_no_tag_in_frontmatter_or_body() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        // Projects/Vitrine has frontmatter (`status:`) but no tags in it.
        #expect(
            index.untagged.map(\.path) == [
                "Scratch.md", "Projects/Vitrine.md", "Topics/Scratch.md",
            ]
        )
    }

    @Test func a_mark_hex_color_a_fenced_tag_and_a_url_fragment_appear_nowhere_in_the_tree()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        let paths = allPaths(in: index.tagTree)
        // `<mark style="background: #FFF3A3A6">` in Topics/Alignment.
        #expect(!paths.contains("fff3a3a6"))
        // `# not a tag: #notatag` inside a python fence in Topics/Interpretability.
        #expect(!paths.contains("notatag"))
        // `https://transformer-circuits.pub/#toc` in Topics/Interpretability.
        #expect(!paths.contains("toc"))
    }

    @Test func frontmatter_values_that_fail_the_tag_grammar_appear_nowhere_in_the_tree() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        // Topics/Alignment lists `"2026"` (all digits) and `foo bar` (a space);
        // Obsidian marks both invalid and shows neither in its Tags pane.
        let paths = allPaths(in: index.tagTree)
        #expect(!paths.contains("2026"))
        #expect(!paths.contains("foo bar"))
    }

    @Test func an_unreadable_note_is_skipped_and_contributes_no_tags() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { try? FileManager.default.removeItem(at: copy) }
        let noPermissions = 0o000
        try FileManager.default.setAttributes(
            [.posixPermissions: noPermissions],
            ofItemAtPath: copy.appending(path: "Topics/Interpretability.md").path)
        let library = try Library.open(at: copy)
        let interpretability = try #require(
            library.allNotes.first { $0.path == "Topics/Interpretability.md" })

        let index = Index.build(from: library)

        #expect(index.skipped == [interpretability])
        #expect(index.tags(of: interpretability).isEmpty)
        // Its interp/saes/dictionary and reading/Notes are gone; the notes that
        // carried interp/saes and reading/paper remain.
        let saes = try #require(index.tagTree.first { $0.path == "interp" }?.children.last)
        #expect(saes.path == "interp/saes")
        #expect(saes.count == 1)
        #expect(saes.children.isEmpty)
        let reading = try #require(index.tagTree.first { $0.path == "reading" })
        #expect(reading.children.map(\.path) == ["reading/paper"])
        #expect(reading.count == 1)
        // A skipped note is neither tagged nor untagged: nothing is known of it.
        #expect(!index.untagged.contains(interpretability))
    }

    @Test func every_fixture_note_parses_and_a_body_rule_is_not_frontmatter() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))

        var parsed: [String: ParsedNote] = [:]
        for note in library.allNotes {
            parsed[note.path] = ParsedNote.parse(try library.read(note))
        }

        // Topics/Agents opens with a heading; its `---` on line 5 is body.
        let agents = try #require(parsed["Topics/Agents.md"])
        #expect(agents.frontmatter == nil)
        #expect(agents.bodyRange.lowerBound == 0)
        #expect(agents.bodyTags.map(\.name) == ["agents"])
        // The notes that do open with `---` have frontmatter.
        #expect(parsed["Welcome.md"]?.frontmatter != nil)
        #expect(parsed["Topics/Alignment.md"]?.frontmatter != nil)
    }

    @Test func an_empty_segment_is_no_segment() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { try? FileManager.default.removeItem(at: copy) }
        // The grammar admits `/` anywhere; the hierarchy reads past the empties.
        // A lone `/` survives only in frontmatter: the body scanner reads a
        // trailing `/` as punctuation.
        try "---\ntags: [\"/\"]\n---\nDoubled #Reading//paper.\n".write(
            to: copy.appending(path: "Slashes.md"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let slashes = try #require(library.allNotes.first { $0.path == "Slashes.md" })

        let index = Index.build(from: library)

        #expect(index.tags(of: slashes) == ["reading/paper"])
        #expect(index.notes(tagged: "reading//paper").map(\.path).contains("Slashes.md"))
        let reading = try #require(index.tagTree.first { $0.path == "reading" })
        #expect(reading.children.map(\.path) == ["reading/notes", "reading/paper"])
        #expect(reading.children.map(\.count) == [1, 2])
        #expect(!allPaths(in: index.tagTree).contains(""))
        #expect(!index.untagged.contains(slashes))
    }

    // MARK: - Links

    @Test func a_wikilink_resolves_to_the_note_with_that_title_case_insensitively() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)

        // `See [[welcome]], …` in the body; the note's title is `Welcome`.
        let links = index.links(from: alignment).filter { !$0.isFromFrontmatter }
        let link = try #require(links.first { $0.target == .note(welcome) })
        #expect(link.displayText == "welcome")
        #expect(slice(try library.read(alignment), link.range) == "[[welcome]]")
    }

    @Test func a_wikilink_to_an_alias_resolves_to_the_note_declaring_it() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)

        // Welcome declares `aliases: [Start here]`; Alignment ends `Or simply [[Start here]].`
        let text = try library.read(alignment)
        let links = index.links(from: alignment).filter { !$0.isFromFrontmatter }
        let link = try #require(links.first { slice(text, $0.range) == "[[Start here]]" })
        #expect(link.target == .note(welcome))
        #expect(link.displayText == "Start here")
    }

    @Test func a_wikilink_to_a_path_resolves_with_or_without_the_extension() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)
        let today = try note(at: "Daily/2026-09-13.md", in: library)

        // Alignment: `the [[Daily/2026-09-13.md]] entry`; Welcome: `in [[Daily/2026-09-13]]`.
        let fromAlignment = index.links(from: alignment)
        #expect(
            fromAlignment.filter { $0.target == .note(today) }.map(\.displayText) == [
                "Daily/2026-09-13.md"
            ])
        let fromWelcome = index.links(from: welcome)
        #expect(
            fromWelcome.filter { $0.target == .note(today) }.map(\.displayText) == [
                "Daily/2026-09-13"
            ])
    }

    @Test func a_wikilink_or_embed_naming_an_attachment_resolves_to_it() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let vitrine = try note(at: "Projects/Vitrine.md", in: library)
        let projects = try #require(library.root.folders.first { $0.name == "Projects" })
        let sketch = try #require(projects.attachments.first { $0.path == "Projects/sketch.png" })

        // Alignment: `and [[sketch.png]].`; Projects/Vitrine: `![[sketch.png]]` then `[[Welcome]]`.
        let fromAlignment = index.links(from: alignment)
        #expect(fromAlignment.filter { $0.target == .attachment(sketch) }.count == 1)
        let fromVitrine = index.links(from: vitrine)
        #expect(
            fromVitrine.map(\.target) == [
                .attachment(sketch), .note(try note(at: "Welcome.md", in: library)),
            ])
        #expect(slice(try library.read(vitrine), fromVitrine[0].range) == "![[sketch.png]]")
    }

    @Test func a_markdown_link_resolves_relative_to_the_linking_note_percent_decoded() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let interpretability = try note(at: "Topics/Interpretability.md", in: library)
        let readingList = try note(at: "Reading List.md", in: library)

        // Topics/Interpretability: `[reading list](../Reading%20List.md)`, then
        // `[[Reading List]]` on the next line.
        let up = index.links(from: interpretability).filter { $0.target == .note(readingList) }
        #expect(up.map(\.displayText) == ["reading list", "Reading List"])
        // Reading List, at the root: `[A markdown link](Welcome.md)`.
        let welcome = try note(at: "Welcome.md", in: library)
        let across = index.links(from: readingList).filter { $0.target == .note(welcome) }
        #expect(across.map(\.displayText) == ["A markdown link"])
    }

    @Test func a_link_with_a_url_scheme_is_external_and_in_no_table() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let interpretability = try note(at: "Topics/Interpretability.md", in: library)

        // `[circuits thread](https://transformer-circuits.pub/#toc)` and
        // `[DEVONthink item](x-devonthink-item://ABC-123)`.
        let shown = index.links(from: interpretability).map(\.displayText)
        #expect(!shown.contains("circuits thread"))
        #expect(!shown.contains("DEVONthink item"))
        #expect(index.unresolvedLinks.isEmpty == false)
        #expect(index.unresolvedLinks.keys.allSatisfy { !$0.hasPrefix("https:") })
        #expect(index.unresolvedLinks.keys.allSatisfy { !$0.hasPrefix("x-devonthink-item:") })
    }

    @Test func a_heading_or_block_fragment_is_ignored_and_the_note_resolves() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let interpretability = try note(at: "Topics/Interpretability.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)

        // `[[Welcome#Welcome|the top]]` then `[[Welcome#^intro]]`.
        let toWelcome = index.links(from: interpretability).filter { $0.target == .note(welcome) }
        #expect(toWelcome.map(\.displayText) == ["the top", "Welcome"])
    }

    @Test func a_bare_title_shared_by_two_notes_resolves_to_the_shallower_then_the_first_in_order()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let scratch = try note(at: "Scratch.md", in: library)
        let morningJournal = try note(at: "Daily/Journal.md", in: library)

        // `Bare links: [[Scratch]] and [[Journal]].` — Scratch.md sits above
        // Topics/Scratch.md; Daily/Journal.md and Topics/Journal.md are level.
        let bare = index.links(from: alignment).filter {
            ["Scratch", "Journal"].contains($0.displayText)
        }
        #expect(bare.map(\.target) == [.note(scratch), .note(morningJournal)])
    }

    @Test func a_link_to_a_missing_target_is_unresolved_and_listed_with_its_linking_note() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)

        // `[[Nowhere]] goes nowhere.` — and nothing else in the fixture is missing.
        #expect(index.links(from: alignment).map(\.target).contains(.unresolved("Nowhere")))
        #expect(index.unresolvedLinks == ["Nowhere": [alignment]])
    }

    @Test func a_frontmatter_link_is_a_backlink_on_its_target_with_the_property_line_as_context()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let readingList = try note(at: "Reading List.md", in: library)

        // Topics/Alignment's frontmatter: `sources:` / `  - "[[Reading List]]"`.
        let backlink = try #require(index.backlinks(to: readingList).first { $0.note == alignment })
        #expect(backlink.contexts == ["  - \"[[Reading List]]\""])
    }

    @Test func a_self_link_is_outgoing_and_never_a_backlink() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)

        // `[[Alignment]] links to itself` — and no other note links to Alignment.
        #expect(index.links(from: alignment).map(\.target).contains(.note(alignment)))
        #expect(index.backlinks(to: alignment).isEmpty)
    }

    @Test func a_note_linking_twice_is_one_backlink_with_each_source_line_as_context() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let interpretability = try note(at: "Topics/Interpretability.md", in: library)
        let readingList = try note(at: "Reading List.md", in: library)

        let backlinks = index.backlinks(to: readingList).filter { $0.note == interpretability }
        #expect(
            backlinks == [
                Backlink(
                    note: interpretability,
                    contexts: [
                        "Back to the [reading list](../Reading%20List.md).",
                        "And again: [[Reading List]].",
                    ])
            ])
    }

    @Test func backlinks_are_sorted_by_the_linking_notes_title() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let welcome = try note(at: "Welcome.md", in: library)

        // Alignment (frontmatter alias, body title, body alias), Interpretability
        // (two fragment links), Reading List (a Markdown link), Vitrine (a wikilink).
        let backlinks = index.backlinks(to: welcome)
        #expect(
            backlinks.map(\.note.path) == [
                "Topics/Alignment.md", "Topics/Interpretability.md", "Reading List.md",
                "Projects/Vitrine.md",
            ])
    }

    @Test func a_backlinks_contexts_are_its_linking_lines_in_document_order_frontmatter_first()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)

        // Alignment reaches Welcome by alias in `sources:`, by title on line 15,
        // and by alias again on line 19 — each line exactly as written.
        let backlink = try #require(index.backlinks(to: welcome).first { $0.note == alignment })
        #expect(
            backlink.contexts == [
                "  - \"[[Start here|the welcome note]]\"",
                "See [[welcome]], the [[Daily/2026-09-13.md]] entry, and [[sketch.png]].",
                "Or simply [[Start here]].",
            ])
    }

    @Test func two_links_to_one_target_on_one_line_are_one_context() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { try? FileManager.default.removeItem(at: copy) }
        try "Twice: [[Welcome]] and [[welcome]].\nOnce more: [[Welcome]].\n".write(
            to: copy.appending(path: "Twice.md"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let twice = try note(at: "Twice.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)

        let index = Index.build(from: library)

        #expect(index.links(from: twice).count == 3)
        let backlink = try #require(index.backlinks(to: welcome).first { $0.note == twice })
        #expect(
            backlink.contexts == ["Twice: [[Welcome]] and [[welcome]].", "Once more: [[Welcome]]."])
    }

    @Test func a_markdown_form_embed_resolves_relative_to_the_note() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { try? FileManager.default.removeItem(at: copy) }
        try "![alt](../Projects/sketch.png)\n".write(
            to: copy.appending(path: "Topics/Embeds.md"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let embeds = try note(at: "Topics/Embeds.md", in: library)
        let projects = try #require(library.root.folders.first { $0.name == "Projects" })
        let sketch = try #require(projects.attachments.first { $0.path == "Projects/sketch.png" })

        let index = Index.build(from: library)

        #expect(index.links(from: embeds).map(\.target) == [.attachment(sketch)])
    }

    @Test func an_embed_of_a_url_is_external_and_in_no_table() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { try? FileManager.default.removeItem(at: copy) }
        try "![web](https://example.com/a.png)\n".write(
            to: copy.appending(path: "Topics/Embeds.md"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let embeds = try note(at: "Topics/Embeds.md", in: library)

        let index = Index.build(from: library)

        #expect(index.links(from: embeds).isEmpty)
        #expect(index.unresolvedLinks.isEmpty == false)
        #expect(index.unresolvedLinks.keys.allSatisfy { !$0.hasPrefix("https:") })
    }

    @Test func a_markdown_link_fragment_is_ignored_and_the_note_resolves() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { try? FileManager.default.removeItem(at: copy) }
        try "[top](../Welcome.md#Welcome)\n".write(
            to: copy.appending(path: "Topics/Fragment.md"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let fragment = try note(at: "Topics/Fragment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)

        let index = Index.build(from: library)

        #expect(index.links(from: fragment).map(\.target) == [.note(welcome)])
    }

    /// The note at `path`, which the fixture is expected to contain.
    private func note(at path: String, in library: Library) throws -> Note {
        try #require(library.allNotes.first { $0.path == path })
    }

    /// The text a UTF-8 offset range points at.
    private func slice(_ text: String, _ range: Range<Int>) -> String {
        String(decoding: Array(text.utf8)[range], as: UTF8.self)
    }

    /// Every node's path at every depth.
    private func allPaths(in nodes: [TagTreeNode]) -> [String] {
        nodes.flatMap { [$0.path] + allPaths(in: $0.children) }
    }
}
