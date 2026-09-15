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

    /// The text a UTF-8 offset range points at.
    private func slice(_ text: String, _ range: Range<Int>) -> String {
        String(decoding: Array(text.utf8)[range], as: UTF8.self)
    }
}
