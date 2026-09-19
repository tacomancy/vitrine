import Fixtures
import Foundation
import Index
import Library
import NoteParsing
import Search
import Testing

@Suite struct SearchTests {
    @Test func a_term_found_only_in_a_title_matches_in_title() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "interpretability")

        #expect(results.map(\.note.path) == ["Topics/Interpretability.md"])
        #expect(results.map(\.matchedInTitle) == [true])
        // "Interpretability" is 16 bytes; the term is the whole title.
        #expect(results.map(\.titleRanges) == [[0..<16]])
    }

    @Test func a_term_found_only_in_a_body_matches_but_not_in_title() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "tenenbaum")

        #expect(results.map(\.note.path) == ["Reading List.md"])
        #expect(results.map(\.matchedInTitle) == [false])
        #expect(results.map(\.titleRanges) == [[]])
    }

    @Test func two_terms_both_have_to_occur() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        // Daily/Journal has "pages" but not "evening".
        #expect(search.results(for: "evening pages").map(\.note.path) == ["Topics/Journal.md"])
    }

    @Test func a_term_matches_inside_a_longer_word() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        // "retraining", in Topics/Café.
        #expect(search.results(for: "train").map(\.note.path) == ["Topics/Café.md"])
    }

    @Test func matching_ignores_diacritics_and_ranges_slice_the_original_text() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "cafe")

        #expect(results.map(\.note.path) == ["Topics/Café.md"])
        let cafe = try #require(results.first)
        #expect(cafe.matchedInTitle)
        // `é` is two bytes: "Café" is five, "cafe" four.
        #expect(cafe.titleRanges == [0..<5])
        #expect(slice(cafe.note.title, 0..<5) == "Café")
        #expect(cafe.excerpt.text == "# Café")
        #expect(cafe.excerpt.ranges == [2..<7])
        #expect(slice(cafe.excerpt.text, 2..<7) == "Café")
    }

    @Test func a_character_that_folds_to_more_than_one_is_ranged_whole_and_once() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        // `ß` folds to `ss`: two folded bytes from one two-byte character.
        try "Weißbier.\n".write(
            to: copy.appending(path: "Straße.md"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let search = Search.build(from: Index.build(from: library))

        let strasse = try #require(
            search.results(for: "strasse").first { $0.note.path == "Straße.md" })
        let s = try #require(search.results(for: "s").first { $0.note.path == "Straße.md" })

        #expect(strasse.matchedInTitle)
        #expect(strasse.titleRanges == [0..<7])
        // `S` at 0, then the `ß` at 4..<6 — once, though `s` hits it twice.
        #expect(s.titleRanges == [0..<1, 4..<6])
        #expect(slice(s.note.title, 4..<6) == "ß")
        #expect(s.excerpt.text == "Weißbier.")
        #expect(s.excerpt.ranges == [3..<5])
    }

    @Test func matching_ignores_case() throws {
        let copy = try uniformlyDatedCopy()
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "sae")

        // `interp/saes` in Alignment's frontmatter, `SAE` in Café's body,
        // `Interp/SAEs/dictionary` in Interpretability's frontmatter.
        #expect(
            results.map(\.note.path) == [
                "Topics/Alignment.md", "Topics/Café.md", "Topics/Interpretability.md",
            ])
        let cafe = try #require(results.first { $0.note.path == "Topics/Café.md" })
        #expect(
            cafe.excerpt.text == "Read at the café: retraining an SAE on the residual stream. #todo"
        )
        #expect(cafe.excerpt.ranges == [33..<36])
        #expect(slice(cafe.excerpt.text, 33..<36) == "SAE")
    }

    @Test func a_term_in_an_alias_counts_as_a_title_match() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "coffee")

        // Café's `aliases: [Coffee]`; the title itself has no "coffee" to wash.
        #expect(results.map(\.note.path) == ["Topics/Café.md"])
        #expect(results.map(\.matchedInTitle) == [true])
        #expect(results.map(\.titleRanges) == [[]])
        #expect(results.map(\.excerpt.text) == ["aliases: [Coffee]"])
        #expect(results.map(\.excerpt.ranges) == [[10..<16]])
    }

    @Test func frontmatter_text_matches() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "bricken")

        #expect(results.map(\.note.path) == ["Topics/Café.md"])
        #expect(results.map(\.matchedInTitle) == [false])
        #expect(results.map(\.excerpt.text) == ["citekey: bricken2023monosemanticity"])
        #expect(results.map(\.excerpt.ranges) == [[9..<16]])
    }

    @Test func a_hash_tag_query_matches_the_literal_text() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "#todo")

        #expect(results.map(\.note.path) == ["Topics/Café.md"])
        #expect(results.map(\.excerpt.ranges) == [[61..<66]])
        #expect(slice(try #require(results.first).excerpt.text, 61..<66) == "#todo")
    }

    @Test func the_excerpt_is_the_first_line_holding_any_term_with_every_occurrence_on_it()
        throws
    {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "reading list")
        let interpretability = try #require(
            results.first { $0.note.path == "Topics/Interpretability.md" })
        let readingList = try #require(results.first { $0.note.path == "Reading List.md" })

        // Interpretability's body opens "Reading #Reading/Notes …", one term
        // twice and the other absent; the line holding both comes later.
        #expect(!interpretability.matchedInTitle)
        #expect(
            interpretability.excerpt.text
                == "Reading #Reading/Notes on the [circuits thread](https://transformer-circuits.pub/#toc)"
        )
        #expect(interpretability.excerpt.ranges == [0..<7, 9..<16])
        // Reading List's heading holds both terms, once each.
        #expect(readingList.excerpt.text == "# Reading List")
        #expect(readingList.excerpt.ranges == [2..<9, 10..<14])
    }

    @Test func the_excerpt_of_a_title_only_match_is_the_first_non_empty_line_with_no_ranges()
        throws
    {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        try "\n\nFirst real line.\nSecond.\n".write(
            to: copy.appending(path: "Zettel.md"), atomically: true, encoding: .utf8)
        let library = try Library.open(at: copy)
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "zettel")

        #expect(results.map(\.note.path) == ["Zettel.md"])
        #expect(results.map(\.matchedInTitle) == [true])
        #expect(results.map(\.excerpt.text) == ["First real line."])
        #expect(results.map(\.excerpt.ranges) == [[]])
    }

    @Test func an_empty_or_whitespace_only_query_matches_nothing() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))

        #expect(search.results(for: "").isEmpty)
        #expect(search.results(for: " \t\n ").isEmpty)
    }

    @Test func title_matches_precede_body_matches_each_group_newest_first_then_display_order()
        throws
    {
        let copy = try uniformlyDatedCopy()
        defer { Fixtures.discard(copy) }
        // "welcome" is in Welcome's title and in the bodies of Reading List,
        // Projects/Vitrine, Topics/Alignment, and Topics/Interpretability.
        // The title match is the oldest; Alignment is the newest body match;
        // the other three tie on the copy's uniform date.
        try setModificationDate(oneDay, of: "Welcome.md", in: copy)
        try setModificationDate(threeDays, of: "Topics/Alignment.md", in: copy)
        let library = try Library.open(at: copy)
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "welcome")

        #expect(
            results.map(\.note.path) == [
                "Welcome.md", "Topics/Alignment.md", "Reading List.md", "Projects/Vitrine.md",
                "Topics/Interpretability.md",
            ])
        #expect(results.map(\.matchedInTitle) == [true, false, false, false, false])
    }

    // MARK: - Currency

    @Test func updating_makes_the_new_text_findable_and_the_old_not() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let built = Search.build(from: Index.build(from: library))
        let welcome = try note(at: "Welcome.md", in: library)

        let search = built.updating(welcome, parsed: ParsedNote.parse("# Welcome\n\nA zebra.\n"))

        #expect(search.results(for: "zebra").map(\.note.path) == ["Welcome.md"])
        #expect(search.results(for: "zebra").map(\.excerpt.text) == ["A zebra."])
        #expect(search.results(for: "zebra").map(\.excerpt.ranges) == [[2..<7]])
        // "This vault was drafted…" is gone with the old text.
        #expect(search.results(for: "vault").isEmpty)
    }

    @Test func adding_makes_a_note_findable_in_its_place_in_display_order() throws {
        let copy = try uniformlyDatedCopy()
        defer { Fixtures.discard(copy) }
        let built = Search.build(from: Index.build(from: try Library.open(at: copy)))
        try "Loose ends.\n".write(
            to: copy.appending(path: "Aardvark.md"), atomically: true, encoding: .utf8)
        try setModificationDate(twoDays, of: "Aardvark.md", in: copy)
        let aardvark = try note(at: "Aardvark.md", in: try Library.open(at: copy))

        let search = built.adding(aardvark, parsed: ParsedNote.parse("Loose ends.\n"))

        #expect(search.results(for: "aardvark").map(\.matchedInTitle) == [true])
        // Scratch has "Loose thoughts" and Research/Survey Sampling "loosely";
        // on one date, the root's `A` comes first and the folder's note last.
        #expect(
            search.results(for: "loose").map(\.note.path) == [
                "Aardvark.md", "Scratch.md", "Research/Survey Sampling.md",
            ])
    }

    @Test func removing_drops_the_note_from_every_query() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let built = Search.build(from: Index.build(from: library))
        let cafe = try note(at: "Topics/Café.md", in: library)

        let search = built.removing(cafe)

        #expect(search.results(for: "café").isEmpty)
        #expect(search.results(for: "coffee").isEmpty)
        #expect(search.results(for: "#todo").isEmpty)
    }

    @Test func renaming_makes_the_new_title_findable_and_the_old_not() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        try "First real line.\n".write(
            to: copy.appending(path: "Zettel.md"), atomically: true, encoding: .utf8)
        var library = try Library.open(at: copy)
        let built = Search.build(from: Index.build(from: library))
        let zettel = try note(at: "Zettel.md", in: library)
        let slip = try library.renameNote(zettel, to: "Slip")

        let search = built.renaming(zettel, to: slip)

        #expect(search.results(for: "zettel").isEmpty)
        #expect(search.results(for: "slip").map(\.note) == [slip])
        #expect(search.results(for: "slip").map(\.matchedInTitle) == [true])
        // The text moved with it.
        #expect(search.results(for: "real").map(\.note) == [slip])
    }

    @Test func a_skipped_note_is_absent_from_every_query() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let noPermissions = 0o000
        try FileManager.default.setAttributes(
            [.posixPermissions: noPermissions],
            ofItemAtPath: copy.appending(path: "Topics/Interpretability.md").path)
        let library = try Library.open(at: copy)
        let index = Index.build(from: library)
        #expect(index.skipped.map(\.path) == ["Topics/Interpretability.md"])

        let search = Search.build(from: index)

        // Its title, and text only it holds, find nothing.
        #expect(search.results(for: "interpretability").isEmpty)
        #expect(search.results(for: "devonthink").isEmpty)
    }

    /// The note at `path`, which the library is expected to hold.
    private func note(at path: String, in library: Library) throws -> Note {
        try #require(library.allNotes.first { $0.path == path })
    }

    @Test func within_the_title_group_the_newest_modified_comes_first() throws {
        let copy = try uniformlyDatedCopy()
        defer { Fixtures.discard(copy) }
        // Two notes titled Journal; Topics/Alignment links to one in its body.
        try setModificationDate(oneDay, of: "Daily/Journal.md", in: copy)
        try setModificationDate(threeDays, of: "Topics/Journal.md", in: copy)
        let library = try Library.open(at: copy)
        let search = Search.build(from: Index.build(from: library))

        let results = search.results(for: "journal")

        #expect(
            results.map(\.note.path) == [
                "Topics/Journal.md", "Daily/Journal.md", "Topics/Alignment.md",
            ]
        )
        #expect(results.map(\.matchedInTitle) == [true, true, false])
    }

    @Test func applying_a_modified_note_makes_its_new_text_findable_and_its_old_not() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let indexed = Index.build(from: library)
        let built = Search.build(from: indexed)
        try "# Scratch\n\nNow filed under quokka.\n".write(
            to: copy.appending(path: "Topics/Scratch.md"), atomically: true, encoding: .utf8)
        let changed = library.applying(.noteModified("Topics/Scratch.md"))
        let index = indexed.applying(.noteModified("Topics/Scratch.md"), in: changed)

        let search = built.applying(.noteModified("Topics/Scratch.md"), in: index)

        #expect(search.results(for: "quokka").map(\.note.path) == ["Topics/Scratch.md"])
        // "deeper" was the old text's word.
        #expect(search.results(for: "deeper").isEmpty)
    }

    @Test func applying_a_removed_note_drops_it() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let indexed = Index.build(from: library)
        let built = Search.build(from: indexed)
        try FileManager.default.removeItem(at: copy.appending(path: "Welcome.md"))
        let changed = library.applying(.entryRemoved("Welcome.md"))
        let index = indexed.applying(.entryRemoved("Welcome.md"), in: changed)

        let search = built.applying(.entryRemoved("Welcome.md"), in: index)

        // "opened once" is in Welcome's text alone.
        #expect(search.results(for: "opened once").isEmpty)
        #expect(search.results(for: "welcome").contains { $0.note.path == "Welcome.md" } == false)
    }

    @Test func applying_a_renamed_note_keeps_its_text_under_its_new_title() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let indexed = Index.build(from: library)
        let built = Search.build(from: indexed)
        try FileManager.default.moveItem(
            at: copy.appending(path: "Welcome.md"), to: copy.appending(path: "Nowhere.md"))
        let change = LibraryChange.entryRenamed(from: "Welcome.md", to: "Nowhere.md")
        let changed = library.applying(change)
        let index = indexed.applying(change, in: changed)
        // Nothing is left to read: the text is the one the Index already held.
        try FileManager.default.removeItem(at: copy.appending(path: "Nowhere.md"))

        let search = built.applying(change, in: index)

        let nowhere = try #require(search.results(for: "nowhere").first)
        #expect(nowhere.note.path == "Nowhere.md")
        #expect(nowhere.matchedInTitle)
        // "opened once" is Welcome's text, now Nowhere's.
        #expect(search.results(for: "opened once").map(\.note.path) == ["Nowhere.md"])
        #expect(search.results(for: "welcome").contains { $0.note.path == "Welcome.md" } == false)
    }

    @Test func applying_a_changed_folder_takes_its_notes_as_the_index_holds_them() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let indexed = Index.build(from: library)
        let built = Search.build(from: indexed)
        let topics = copy.appending(path: "Topics")
        try "# Circuits\n\nA quokka in every circuit.\n".write(
            to: topics.appending(path: "Circuits.md"), atomically: true, encoding: .utf8)
        try FileManager.default.removeItem(at: topics.appending(path: "Agents.md"))
        let changed = library.applying(.folderChanged("Topics"))
        let index = indexed.applying(.folderChanged("Topics"), in: changed)

        let search = built.applying(.folderChanged("Topics"), in: index)

        #expect(search.results(for: "quokka").map(\.note.path) == ["Topics/Circuits.md"])
        #expect(
            search.results(for: "agents").contains { $0.note.path == "Topics/Agents.md" } == false)
        // A note in the folder the change did not touch is still there.
        #expect(search.results(for: "cafe").map(\.note.path) == ["Topics/Café.md"])
    }

    @Test func applying_a_change_to_a_note_that_cannot_be_read_leaves_it_absent() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let indexed = Index.build(from: library)
        let built = Search.build(from: indexed)
        let welcome = copy.appending(path: "Welcome.md")
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: welcome.path)
        defer {
            try? FileManager.default.setAttributes(
                [.posixPermissions: 0o644], ofItemAtPath: welcome.path)
        }
        let changed = library.applying(.noteModified("Welcome.md"))
        let index = indexed.applying(.noteModified("Welcome.md"), in: changed)

        let search = built.applying(.noteModified("Welcome.md"), in: index)

        #expect(search.results(for: "opened once").isEmpty)
    }

    @Test func the_excerpt_of_a_note_outside_any_query_is_its_first_non_empty_line() throws {
        let library = try Library.open(at: Fixtures.library("obsidian-vault"))
        let search = Search.build(from: Index.build(from: library))
        let welcome = try #require(library.note(at: "Welcome.md"))

        // Welcome's first line is its frontmatter fence.
        #expect(search.excerpt(of: welcome)?.text == "---")
        #expect(search.excerpt(of: welcome)?.ranges == [])
        #expect(search.removing(welcome).excerpt(of: welcome) == nil)
    }

    /// The text a UTF-8 offset range points at.
    private func slice(_ text: String, _ range: Range<Int>) -> String {
        String(decoding: Array(text.utf8)[range], as: UTF8.self)
    }

    private let oneDay = Date(timeIntervalSince1970: 86_400)
    private let twoDays = Date(timeIntervalSince1970: 2 * 86_400)
    private let threeDays = Date(timeIntervalSince1970: 3 * 86_400)

    /// A temporary copy of the Obsidian fixture with every note modified at
    /// `twoDays`, so notes tie on date and results fall to library display
    /// order — a checkout gives the files whatever dates it likes. The
    /// caller discards it.
    private func uniformlyDatedCopy() throws -> URL {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        for note in try Library.open(at: copy).allNotes {
            try setModificationDate(twoDays, of: note.path, in: copy)
        }
        return copy
    }

    private func setModificationDate(_ date: Date, of path: String, in copy: URL) throws {
        try FileManager.default.setAttributes(
            [.modificationDate: date], ofItemAtPath: copy.appending(path: path).path)
    }
}
