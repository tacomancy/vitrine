import Foundation
import Library
import Testing

@Suite struct LibraryTests {
    @Test func name_is_the_folder_name() throws {
        let library = try Library.open(at: fixture("scan-rules"))

        #expect(library.name == "scan-rules")
    }

    @Test func opening_a_file_instead_of_a_folder_throws_notAFolder() throws {
        let note = try fixture("scan-rules").appending(path: "apple.md")

        #expect(throws: LibraryError.notAFolder) {
            try Library.open(at: note)
        }
    }

    @Test func opening_an_unreadable_folder_throws_unreadable() throws {
        let copy = try temporaryCopy(ofFixture: "scan-rules")
        defer { try? FileManager.default.removeItem(at: copy) }
        let noPermissions = 0o000
        let readable = 0o755
        try FileManager.default.setAttributes([.posixPermissions: noPermissions], ofItemAtPath: copy.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: readable], ofItemAtPath: copy.path) }

        #expect(throws: LibraryError.unreadable) {
            try Library.open(at: copy)
        }
    }

    @Test func a_folder_with_zero_notes_opens_as_an_empty_library() throws {
        let empty = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: empty) }

        let library = try Library.open(at: empty)

        #expect(library.root.folders.isEmpty)
        #expect(library.root.notes.isEmpty)
        #expect(library.root.attachments.isEmpty)
        #expect(library.allNotes.isEmpty)
    }

    @Test func a_file_is_a_note_when_its_extension_is_md_in_any_case() throws {
        let library = try Library.open(at: fixture("scan-rules"))

        let names = library.root.notes.map(\.name)
        #expect(names.contains("apple.md"))
        #expect(names.contains("Zed.MD"))
    }

    @Test func every_other_file_is_an_attachment() throws {
        let library = try Library.open(at: fixture("scan-rules"))

        let names = library.root.attachments.map(\.name)
        #expect(names.contains("notes.txt"))
        #expect(!names.contains("apple.md"))
        #expect(!names.contains("Zed.MD"))
    }

    @Test func entries_whose_name_begins_with_a_dot_are_skipped() throws {
        let library = try Library.open(at: fixture("scan-rules"))

        #expect(!library.root.attachments.map(\.name).contains(".DS_Store"))
        #expect(!library.root.attachments.map(\.name).contains(".hidden"))
        #expect(!library.root.folders.map(\.name).contains(".hidden"))
        #expect(!library.allNotes.map(\.title).contains("Hidden Note"))
    }

    @Test func symbolic_links_are_not_followed() throws {
        let library = try Library.open(at: fixture("scan-rules"))

        #expect(!library.root.folders.map(\.name).contains("Linked Alpha"))
        #expect(!library.root.attachments.map(\.name).contains("Linked Alpha"))
        #expect(!library.allNotes.contains { $0.path.hasPrefix("Linked Alpha/") })
    }

    @Test func allNotes_counts_every_note_at_every_depth() throws {
        let library = try Library.open(at: fixture("scan-rules"))

        // 4 at the root, 4 in Alpha, 1 in beta/Zeta.
        #expect(library.allNotes.count == 9)
        #expect(library.allNotes.map(\.title).contains("Deep Note"))
    }

    @Test func folders_come_before_files_and_each_list_is_in_natural_order() throws {
        let library = try Library.open(at: fixture("scan-rules"))
        let alpha = try #require(library.root.folders.first)

        #expect(library.root.folders.map(\.name) == ["Alpha", "beta"])
        #expect(library.root.notes.map(\.title) == ["apple", "Banana", "Same Title", "Zed"])
        #expect(alpha.notes.map(\.title) == ["Note 1", "Note 2", "Note 10", "Same Title"])
    }

    @Test func two_notes_with_the_same_title_in_different_folders_are_distinct_by_path() throws {
        let library = try Library.open(at: fixture("scan-rules"))

        let sameTitle = library.allNotes.filter { $0.title == "Same Title" }
        #expect(sameTitle.map(\.path) == ["Same Title.md", "Alpha/Same Title.md"])
        #expect(sameTitle.map(\.name) == ["Same Title.md", "Same Title.md"])
        #expect(Set(sameTitle).count == 2)
    }

    // MARK: - Fixtures

    /// A fixture library shipped as a package resource (CODING_STANDARDS §6).
    private func fixture(_ name: String) throws -> URL {
        try #require(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"))
    }

    /// A private copy of a fixture for tests that break something, so the
    /// suite runs in any order and in parallel. The caller removes it.
    private func temporaryCopy(ofFixture name: String) throws -> URL {
        let copy = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: name)
        try FileManager.default.createDirectory(
            at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: fixture(name), to: copy)
        return copy
    }
}
