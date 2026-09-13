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

    /// Every node's path at every depth.
    private func allPaths(in nodes: [TagTreeNode]) -> [String] {
        nodes.flatMap { [$0.path] + allPaths(in: $0.children) }
    }
}
