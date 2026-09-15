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
                "agents", "Alignment", "daily", "data", "fixture", "interp", "learning",
                "project", "reading", "stats", "vitrine",
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

    @Test func co_occurring_tags_count_each_note_once_per_other_tag_out_of_the_tags_notes()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)

        // Three notes carry stats or a tag under it: Bayesian Inference
        // (stats/bayesian, learning/probabilistic, learning/supervised), Linear
        // Regression (stats, learning/supervised, data/tabular), Survey Sampling
        // (stats/frequentist, data/tabular, data/survey, learning/supervised).
        #expect(
            index.coOccurringTags(with: "stats") == [
                TagCoOccurrence(tag: "learning", count: 3, outOf: 3),
                TagCoOccurrence(tag: "learning/supervised", count: 3, outOf: 3),
                TagCoOccurrence(tag: "data", count: 2, outOf: 3),
                TagCoOccurrence(tag: "data/tabular", count: 2, outOf: 3),
                TagCoOccurrence(tag: "data/survey", count: 1, outOf: 3),
                TagCoOccurrence(tag: "learning/probabilistic", count: 1, outOf: 3),
            ])
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

    // MARK: - Currency

    @Test func updating_a_note_that_gained_a_tag_changes_its_tags_and_the_trees_counts_only()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let built = Index.build(from: library)
        let scratch = try note(at: "Topics/Scratch.md", in: library)

        // The parse alone, not the file: on disk Topics/Scratch still has no tag.
        let index = built.updating(
            scratch, parsed: ParsedNote.parse("# Scratch\n\nNow filed. #daily #reading/paper\n"))

        #expect(index.tags(of: scratch) == ["daily", "reading/paper"])
        let daily = try #require(index.tagTree.first { $0.path == "daily" })
        #expect(daily.count == 4)
        let reading = try #require(index.tagTree.first { $0.path == "reading" })
        #expect(reading.count == 3)
        #expect(reading.children.map(\.count) == [1, 2])
        #expect(
            index.tagTree.filter { !["daily", "reading"].contains($0.path) }
                == built.tagTree.filter { !["daily", "reading"].contains($0.path) })
        #expect(index.untagged.map(\.path) == ["Scratch.md", "Projects/Vitrine.md"])
        #expect(
            index.notes(tagged: "daily").map(\.path) == [
                "Daily/2026-09-13.md", "Daily/Journal.md", "Topics/Journal.md", "Topics/Scratch.md",
            ])
        #expect(index.unresolvedLinks == built.unresolvedLinks)
    }

    @Test func updating_a_note_that_dropped_its_only_link_to_a_target_removes_that_backlink_only()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let built = Index.build(from: library)
        let vitrine = try note(at: "Projects/Vitrine.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)
        let readingList = try note(at: "Reading List.md", in: library)

        // Projects/Vitrine's `Back to [[Welcome]].` becomes a link to Reading List.
        let index = built.updating(
            vitrine,
            parsed: ParsedNote.parse(
                "---\nstatus: active\n---\n# Vitrine\n\n![[sketch.png]]\n\nOn to [[Reading List]].\n"
            ))

        #expect(
            index.backlinks(to: welcome).map(\.note.path) == [
                "Topics/Alignment.md", "Topics/Interpretability.md", "Reading List.md",
            ])
        #expect(
            index.backlinks(to: welcome)
                == built.backlinks(to: welcome).filter { $0.note != vitrine })
        let gained = try #require(index.backlinks(to: readingList).first { $0.note == vitrine })
        #expect(gained.contexts == ["On to [[Reading List]]."])
        #expect(index.links(from: vitrine).map(\.displayText) == ["sketch.png", "Reading List"])
    }

    @Test func adding_a_note_titled_like_an_unresolved_target_resolves_those_links() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        // The file exists so the library can name it; its text is the parse's
        // business, and on disk it stays empty.
        let nowhere = try library.createNote(named: "Nowhere", in: library.root)

        let index = built.adding(nowhere, parsed: ParsedNote.parse("# Nowhere\n\nFound. #daily\n"))

        #expect(index.unresolvedLinks.isEmpty)
        #expect(index.links(from: alignment).map(\.target).contains(.note(nowhere)))
        #expect(
            index.backlinks(to: nowhere) == [
                Backlink(
                    note: alignment,
                    contexts: ["[[Alignment]] links to itself; [[Nowhere]] goes nowhere."])
            ])
        #expect(index.tags(of: nowhere) == ["daily"])
        #expect(
            index.notes(tagged: "daily").map(\.path) == [
                "Nowhere.md", "Daily/2026-09-13.md", "Daily/Journal.md", "Topics/Journal.md",
            ])
        #expect(index.untagged == built.untagged)
    }

    @Test func removing_a_note_unresolves_links_to_it_and_takes_its_tags_out_of_the_tree() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let built = Index.build(from: library)
        let welcome = try note(at: "Welcome.md", in: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let interpretability = try note(at: "Topics/Interpretability.md", in: library)
        let readingList = try note(at: "Reading List.md", in: library)
        let vitrine = try note(at: "Projects/Vitrine.md", in: library)

        // Welcome.md stays on disk; the Index is told it is gone.
        let index = built.removing(welcome)

        // Welcome was reached by title, by its alias `Start here`, and by path.
        #expect(
            index.unresolvedLinks == [
                "Nowhere": [alignment],
                "welcome": [alignment],
                "Start here": [alignment],
                "Welcome": [vitrine, interpretability],
                "Welcome.md": [readingList],
            ])
        #expect(index.backlinks(to: welcome).isEmpty)
        #expect(index.links(from: welcome).isEmpty)
        #expect(index.tags(of: welcome).isEmpty)
        // Only Welcome carried `vitrine` and `fixture`.
        #expect(
            index.tagTree.map(\.name) == [
                "agents", "Alignment", "daily", "data", "interp", "learning", "project",
                "reading", "stats",
            ])
        #expect(index.notes(tagged: "vitrine").isEmpty)
        #expect(index.untagged == built.untagged)
        #expect(index.skipped.isEmpty)
    }

    @Test func renaming_a_note_re_resolves_links_by_title_and_keeps_its_backlinks_by_alias()
        throws
    {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let welcome = try note(at: "Welcome.md", in: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let interpretability = try note(at: "Topics/Interpretability.md", in: library)
        let readingList = try note(at: "Reading List.md", in: library)
        let vitrine = try note(at: "Projects/Vitrine.md", in: library)
        let nowhere = try library.renameNote(welcome, to: "Nowhere")

        let index = built.renaming(welcome, to: nowhere)

        // `[[Nowhere]]` now lands; `[[welcome]]`, `[[Welcome#…]]`, `[[Welcome]]`,
        // and `[A markdown link](Welcome.md)` no longer do.
        #expect(
            index.unresolvedLinks == [
                "welcome": [alignment],
                "Welcome": [vitrine, interpretability],
                "Welcome.md": [readingList],
            ])
        // Alignment still reaches the note by its alias, twice, and now by title.
        #expect(
            index.backlinks(to: nowhere) == [
                Backlink(
                    note: alignment,
                    contexts: [
                        "  - \"[[Start here|the welcome note]]\"",
                        "[[Alignment]] links to itself; [[Nowhere]] goes nowhere.",
                        "Or simply [[Start here]].",
                    ])
            ])
        #expect(index.backlinks(to: welcome).isEmpty)
        // The note's own parse moved with it.
        #expect(
            index.links(from: nowhere).map(\.displayText) == ["Reading List", "Daily/2026-09-13"])
        #expect(index.tags(of: nowhere) == ["vitrine", "fixture"])
        #expect(index.notes(tagged: "vitrine") == [nowhere])
        #expect(index.untagged == built.untagged)
    }

    @Test func untagged_and_notes_tagged_follow_every_operation_in_library_display_order() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        var index = Index.build(from: library)
        let scratch = try note(at: "Scratch.md", in: library)
        let topicsScratch = try note(at: "Topics/Scratch.md", in: library)
        let vitrine = try note(at: "Projects/Vitrine.md", in: library)
        let topics = try #require(library.root.folders.first { $0.name == "Topics" })
        // The library names the notes the index will be told about.
        let aardvark = try library.createNote(named: "Aardvark", in: topics)
        let untitled = try library.renameNote(vitrine, to: "Untitled")

        index = index.updating(topicsScratch, parsed: ParsedNote.parse("Filed. #daily\n"))
        #expect(index.untagged.map(\.path) == ["Scratch.md", "Projects/Vitrine.md"])
        #expect(index.notes(tagged: "daily").map(\.path).last == "Topics/Scratch.md")

        index = index.adding(aardvark, parsed: ParsedNote.parse("Nothing here.\n"))
        #expect(
            index.untagged.map(\.path) == [
                "Scratch.md", "Projects/Vitrine.md", "Topics/Aardvark.md",
            ])

        index = index.removing(scratch)
        #expect(index.untagged.map(\.path) == ["Projects/Vitrine.md", "Topics/Aardvark.md"])

        index = index.renaming(vitrine, to: untitled)
        #expect(index.untagged.map(\.path) == ["Projects/Untitled.md", "Topics/Aardvark.md"])
        #expect(index.untagged.map(\.title) == ["Untitled", "Aardvark"])
    }

    @Test func no_operation_reads_the_file_system() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        // Discarded early below, once the library has named every note; the
        // defer covers a `try` failing before that.
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)
        let interpretability = try note(at: "Topics/Interpretability.md", in: library)
        let readingList = try note(at: "Reading List.md", in: library)
        let vitrine = try note(at: "Projects/Vitrine.md", in: library)
        let nowhere = try library.createNote(named: "Nowhere", in: library.root)
        let journal = try note(at: "Daily/Journal.md", in: library)
        let morning = try library.renameNote(journal, to: "Morning")
        // Nothing is left to read: every answer below comes from the parses.
        Fixtures.discard(copy)

        let index =
            built
            .updating(alignment, parsed: ParsedNote.parse("Only [[Nowhere]] now. #alignment\n"))
            .adding(nowhere, parsed: ParsedNote.parse("Here. #daily\n"))
            .removing(welcome)
            .renaming(journal, to: morning)

        #expect(index.links(from: alignment).map(\.target) == [.note(nowhere)])
        #expect(
            index.backlinks(to: nowhere) == [
                Backlink(note: alignment, contexts: ["Only [[Nowhere]] now. #alignment"])
            ])
        #expect(
            index.unresolvedLinks == [
                "Welcome": [vitrine, interpretability], "Welcome.md": [readingList],
            ])
        #expect(index.tags(of: morning) == ["daily"])
        #expect(index.notes(tagged: "daily").map(\.path).contains("Daily/Morning.md"))
        #expect(index.skipped.isEmpty)
    }

    // MARK: - Following another tool's changes

    @Test func applying_a_modified_note_reads_it_again_and_updates_its_tags() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        try "# Scratch\n\nNow filed. #daily\n".write(
            to: copy.appending(path: "Topics/Scratch.md"), atomically: true, encoding: .utf8)
        let changed = library.applying(.noteModified("Topics/Scratch.md"))
        let scratch = try note(at: "Topics/Scratch.md", in: changed)

        let index = built.applying(.noteModified("Topics/Scratch.md"), in: changed)

        #expect(index.tags(of: scratch) == ["daily"])
        #expect(
            index.notes(tagged: "daily").map(\.path) == [
                "Daily/2026-09-13.md", "Daily/Journal.md", "Topics/Journal.md", "Topics/Scratch.md",
            ])
        #expect(index.untagged.map(\.path) == ["Scratch.md", "Projects/Vitrine.md"])
    }

    @Test func applying_an_added_note_reads_it_and_resolves_links_to_its_title() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        try "# Nowhere\n\nFound. #daily\n".write(
            to: copy.appending(path: "Nowhere.md"), atomically: true, encoding: .utf8)
        let changed = library.applying(.entryAdded("Nowhere.md"))
        let nowhere = try note(at: "Nowhere.md", in: changed)
        let alignment = try note(at: "Topics/Alignment.md", in: changed)

        let index = built.applying(.entryAdded("Nowhere.md"), in: changed)

        #expect(index.tags(of: nowhere) == ["daily"])
        #expect(index.links(from: alignment).map(\.target).contains(.note(nowhere)))
        #expect(index.unresolvedLinks["Nowhere"] == nil)
        #expect(index.backlinks(to: nowhere).map(\.note) == [alignment])
    }

    @Test func applying_a_removed_note_unresolves_links_to_it_and_drops_its_tags() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let welcome = try note(at: "Welcome.md", in: library)
        try FileManager.default.removeItem(at: copy.appending(path: "Welcome.md"))
        let changed = library.applying(.entryRemoved("Welcome.md"))
        let vitrine = try note(at: "Projects/Vitrine.md", in: changed)

        let index = built.applying(.entryRemoved("Welcome.md"), in: changed)

        #expect(index.backlinks(to: welcome).isEmpty)
        #expect(index.unresolvedLinks["Welcome"]?.contains(vitrine) == true)
        #expect(index.tagTree.contains { $0.path == "vitrine" } == false)
        #expect(index.notes(tagged: "fixture").isEmpty)
    }

    @Test func applying_a_renamed_note_keeps_its_parse_and_re_resolves_links_by_title() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        try FileManager.default.moveItem(
            at: copy.appending(path: "Welcome.md"), to: copy.appending(path: "Nowhere.md"))
        let change = LibraryChange.entryRenamed(from: "Welcome.md", to: "Nowhere.md")
        let changed = library.applying(change)
        let nowhere = try note(at: "Nowhere.md", in: changed)
        let alignment = try note(at: "Topics/Alignment.md", in: changed)
        // Nothing is left to read: the renamed note's parse is the one already held.
        try FileManager.default.removeItem(at: copy.appending(path: "Nowhere.md"))

        let index = built.applying(change, in: changed)

        #expect(index.tags(of: nowhere) == ["vitrine", "fixture"])
        let targets = index.links(from: alignment).map(\.target)
        #expect(targets.contains(.note(nowhere)))
        #expect(targets.contains(.unresolved("welcome")))
        // `[[Start here]]` still reaches it by the alias in its kept frontmatter.
        #expect(index.backlinks(to: nowhere).map(\.note) == [alignment])
    }

    @Test func applying_an_added_folder_reads_every_note_under_it() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let deep = copy.appending(path: "Archive/Deep")
        try FileManager.default.createDirectory(at: deep, withIntermediateDirectories: true)
        try "# Nowhere\n\nFound. #daily\n".write(
            to: copy.appending(path: "Archive/Nowhere.md"), atomically: true, encoding: .utf8)
        try "# Circuits\n".write(
            to: deep.appending(path: "Circuits.md"), atomically: true, encoding: .utf8)
        let changed = library.applying(.entryAdded("Archive"))
        let nowhere = try note(at: "Archive/Nowhere.md", in: changed)
        let circuits = try note(at: "Archive/Deep/Circuits.md", in: changed)
        let alignment = try note(at: "Topics/Alignment.md", in: changed)

        let index = built.applying(.entryAdded("Archive"), in: changed)

        #expect(index.tags(of: nowhere) == ["daily"])
        #expect(index.untagged.contains(circuits))
        #expect(index.backlinks(to: nowhere).map(\.note) == [alignment])
    }

    @Test func applying_a_removed_folder_takes_every_note_under_it_out() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let journal = try note(at: "Daily/Journal.md", in: library)
        try FileManager.default.removeItem(at: copy.appending(path: "Daily"))
        let changed = library.applying(.entryRemoved("Daily"))
        let alignment = try note(at: "Topics/Alignment.md", in: changed)
        let welcome = try note(at: "Welcome.md", in: changed)

        let index = built.applying(.entryRemoved("Daily"), in: changed)

        #expect(index.notes(tagged: "daily").map(\.path) == ["Topics/Journal.md"])
        // Welcome's `[[Daily/2026-09-13]]` and Alignment's `[[Daily/2026-09-13.md]]` come loose;
        // a bare `[[Journal]]` now reaches the one in Topics.
        #expect(index.unresolvedLinks["Daily/2026-09-13"] == [welcome])
        #expect(index.unresolvedLinks["Daily/2026-09-13.md"] == [alignment])
        #expect(index.backlinks(to: journal).isEmpty)
        let topicsJournal = try note(at: "Topics/Journal.md", in: changed)
        #expect(index.backlinks(to: topicsJournal).map(\.note) == [alignment])
    }

    @Test func applying_a_renamed_folder_moves_every_note_under_it_with_its_parse() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        try FileManager.default.moveItem(
            at: copy.appending(path: "Daily"), to: copy.appending(path: "Archive"))
        let change = LibraryChange.entryRenamed(from: "Daily", to: "Archive")
        let changed = library.applying(change)
        let journal = try note(at: "Archive/Journal.md", in: changed)
        let welcome = try note(at: "Welcome.md", in: changed)
        // Nothing is left to read: the moved notes' parses are the ones already held.
        try FileManager.default.removeItem(at: copy.appending(path: "Archive"))

        let index = built.applying(change, in: changed)

        #expect(index.tags(of: journal) == ["daily"])
        #expect(
            index.notes(tagged: "daily").map(\.path) == [
                "Archive/2026-09-13.md", "Archive/Journal.md", "Topics/Journal.md",
            ])
        #expect(index.unresolvedLinks["Daily/2026-09-13"] == [welcome])
    }

    @Test func applying_a_changed_folder_reconciles_the_notes_under_it_with_the_disk() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let topics = copy.appending(path: "Topics")
        try "# Scratch\n\nNow filed. #daily\n".write(
            to: topics.appending(path: "Scratch.md"), atomically: true, encoding: .utf8)
        try FileManager.default.removeItem(at: topics.appending(path: "Agents.md"))
        try "# Circuits\n\n#interp/circuits\n".write(
            to: topics.appending(path: "Circuits.md"), atomically: true, encoding: .utf8)
        let changed = library.applying(.folderChanged("Topics"))
        let scratch = try note(at: "Topics/Scratch.md", in: changed)
        let circuits = try note(at: "Topics/Circuits.md", in: changed)

        let index = built.applying(.folderChanged("Topics"), in: changed)

        #expect(index.tags(of: scratch) == ["daily"])
        #expect(index.tags(of: circuits) == ["interp/circuits"])
        #expect(index.tagTree.contains { $0.path == "agents" } == false)
        #expect(
            index.notes(tagged: "interp/circuits").map(\.path) == [
                "Topics/Alignment.md", "Topics/Circuits.md",
            ])
    }

    @Test func applying_a_removed_attachment_unresolves_the_embeds_and_links_to_it() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        try FileManager.default.removeItem(at: copy.appending(path: "Projects/sketch.png"))
        let changed = library.applying(.entryRemoved("Projects/sketch.png"))
        let vitrine = try note(at: "Projects/Vitrine.md", in: changed)
        let alignment = try note(at: "Topics/Alignment.md", in: changed)

        let index = built.applying(.entryRemoved("Projects/sketch.png"), in: changed)

        #expect(index.links(from: vitrine).map(\.target).contains(.unresolved("sketch.png")))
        #expect(index.unresolvedLinks["sketch.png"] == [vitrine, alignment])
    }

    @Test func applying_an_added_attachment_resolves_the_embeds_and_links_to_it() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let sketch = copy.appending(path: "Projects/sketch.png")
        let elsewhere = copy.deletingLastPathComponent().appending(path: "sketch.png")
        try FileManager.default.moveItem(at: sketch, to: elsewhere)
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        try FileManager.default.moveItem(at: elsewhere, to: sketch)
        let changed = library.applying(.entryAdded("Projects/sketch.png"))
        let vitrine = try note(at: "Projects/Vitrine.md", in: changed)
        let attachment = try #require(changed.root.allAttachments.first { $0.name == "sketch.png" })

        let index = built.applying(.entryAdded("Projects/sketch.png"), in: changed)

        #expect(built.unresolvedLinks["sketch.png"]?.isEmpty == false)
        #expect(index.links(from: vitrine).map(\.target).contains(.attachment(attachment)))
        #expect(index.unresolvedLinks["sketch.png"] == nil)
    }

    @Test func applying_an_added_note_that_cannot_be_read_records_it_as_skipped() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        let locked = copy.appending(path: "Locked.md")
        try "# Locked\n\n#daily\n".write(to: locked, atomically: true, encoding: .utf8)
        let noPermissions = 0o000
        try FileManager.default.setAttributes(
            [.posixPermissions: noPermissions], ofItemAtPath: locked.path)
        let changed = library.applying(.entryAdded("Locked.md"))
        let note = try note(at: "Locked.md", in: changed)

        let index = built.applying(.entryAdded("Locked.md"), in: changed)

        #expect(index.skipped == [note])
        #expect(index.untagged.contains(note) == false)
        // A skipped note is still a link target (CONTEXT.md § Index).
        #expect(index.unresolvedLinks["Locked"] == nil)
    }

    @Test func applying_a_rename_that_turns_an_attachment_into_a_note_reads_the_note() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        try "# Nowhere\n\n#daily\n".write(
            to: copy.appending(path: "Nowhere.txt"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let built = Index.build(from: library)
        try FileManager.default.moveItem(
            at: copy.appending(path: "Nowhere.txt"), to: copy.appending(path: "Nowhere.md"))
        let change = LibraryChange.entryRenamed(from: "Nowhere.txt", to: "Nowhere.md")
        let changed = library.applying(change)
        let nowhere = try note(at: "Nowhere.md", in: changed)

        let index = built.applying(change, in: changed)

        #expect(index.tags(of: nowhere) == ["daily"])
        #expect(index.unresolvedLinks["Nowhere"] == nil)
    }

    // MARK: - Creating a note from an unresolved link

    @Test func an_unresolved_targets_title_for_a_new_note_is_its_last_path_component_without_md() {
        #expect(
            LinkTarget.unresolved("Helpful Youtube Videos").titleForNewNote
                == "Helpful Youtube Videos")
        #expect(LinkTarget.unresolved("Topics/Circuits").titleForNewNote == "Circuits")
        #expect(LinkTarget.unresolved("Topics/Circuits.md").titleForNewNote == "Circuits")
        #expect(LinkTarget.unresolved("Notes.MD").titleForNewNote == "Notes")
    }

    // MARK: - Resolving a link the Index has not seen

    @Test func resolve_answers_a_link_in_unsaved_text_from_the_indexs_tables() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)
        // Typed, not saved: the Index holds Alignment as it is on disk.
        let typed = ParsedNote.parse("See [[welcome]] and [[Nowhere]].\n")

        let resolved = typed.links.compactMap { index.resolve($0, from: alignment) }

        #expect(resolved.map(\.target) == [.note(welcome), .unresolved("Nowhere")])
        #expect(resolved.map(\.range) == typed.links.map(\.range))
        #expect(resolved.map(\.displayText) == ["welcome", "Nowhere"])
        #expect(index.links(from: alignment).map(\.target) != resolved.map(\.target))
    }

    @Test func resolve_places_a_markdown_link_relative_to_the_note_and_an_embed_by_filename()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let welcome = try note(at: "Welcome.md", in: library)
        let projects = try #require(library.root.folders.first { $0.name == "Projects" })
        let sketch = try #require(projects.attachments.first { $0.path == "Projects/sketch.png" })
        let typed = ParsedNote.parse("[up](../Welcome.md) ![[sketch.png]] ![[gone.png]]\n")
        let markdownLink = try #require(typed.links.first)

        let link = try #require(index.resolve(markdownLink, from: alignment))
        let embeds = typed.embeds.compactMap { index.resolve($0, from: alignment) }

        #expect(link.target == .note(welcome))
        #expect(embeds.map(\.target) == [.attachment(sketch), .unresolved("gone.png")])
        #expect(embeds.map(\.range) == typed.embeds.map(\.range))
    }

    @Test func resolve_answers_nil_for_an_external_link_or_embed() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let index = Index.build(from: library)
        let alignment = try note(at: "Topics/Alignment.md", in: library)
        let typed = ParsedNote.parse("[site](https://example.com) ![[https://example.com/a.png]]\n")

        let link = try #require(typed.links.first)
        let embed = try #require(typed.embeds.first)

        #expect(index.resolve(link, from: alignment) == nil)
        #expect(index.resolve(embed, from: alignment) == nil)
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
