import Fixtures
import Foundation
import Library
import Testing

@Suite struct LibraryTests {
    @Test func name_is_the_folder_name() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))

        #expect(library.name == "scan-rules")
    }

    @Test func opening_a_file_instead_of_a_folder_throws_notAFolder() throws {
        let note = try Fixtures.library("scan-rules").appending(path: "apple.md")

        #expect(throws: LibraryError.notAFolder) {
            try Library.open(at: note)
        }
    }

    @Test func opening_an_unreadable_folder_throws_unreadable() throws {
        let copy = try Fixtures.temporaryCopy(of: "scan-rules")
        defer { try? FileManager.default.removeItem(at: copy) }
        let noPermissions = 0o000
        let readable = 0o755
        try FileManager.default.setAttributes(
            [.posixPermissions: noPermissions], ofItemAtPath: copy.path)
        defer {
            try? FileManager.default.setAttributes(
                [.posixPermissions: readable], ofItemAtPath: copy.path)
        }

        #expect(throws: LibraryError.unreadable) {
            try Library.open(at: copy)
        }
    }

    @Test func each_error_describes_itself_in_plain_words() {
        #expect(
            LibraryError.notAFolder.localizedDescription
                == "That isn’t a folder. Vitrine opens a folder of Markdown files.")
        #expect(
            LibraryError.unreadable.localizedDescription
                == "Vitrine can’t read it. Check its permissions and try again.")
        #expect(
            LibraryError.noteMissing.localizedDescription
                == "The note is no longer where it was on disk.")
    }

    @Test func two_scans_of_the_same_folder_are_equal_and_of_different_folders_are_not() throws {
        let scanRules = try Library.open(at: Fixtures.library("scan-rules"))
        let scanRulesAgain = try Library.open(at: Fixtures.library("scan-rules"))
        let obsidianVault = try Library.open(at: Fixtures.library("obsidian-vault"))

        #expect(scanRules == scanRulesAgain)
        #expect(scanRules != obsidianVault)
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
        let library = try Library.open(at: Fixtures.library("scan-rules"))

        let names = library.root.notes.map(\.name)
        #expect(names.contains("apple.md"))
        #expect(names.contains("Zed.MD"))
    }

    @Test func every_other_file_is_an_attachment() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))

        let names = library.root.attachments.map(\.name)
        #expect(names.contains("notes.txt"))
        #expect(!names.contains("apple.md"))
        #expect(!names.contains("Zed.MD"))
    }

    @Test func entries_whose_name_begins_with_a_dot_are_skipped() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))

        #expect(!library.root.notes.map(\.name).contains(".dotfile.md"))
        #expect(!library.root.attachments.map(\.name).contains(".dotfile.md"))
        #expect(!library.root.folders.map(\.name).contains(".hidden"))
        #expect(!library.allNotes.map(\.title).contains("Hidden Note"))
    }

    @Test func symbolic_links_are_not_followed() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))

        #expect(!library.root.folders.map(\.name).contains("Linked alpha"))
        #expect(!library.root.attachments.map(\.name).contains("Linked alpha"))
        #expect(!library.allNotes.contains { $0.path.hasPrefix("Linked alpha/") })
        #expect(!library.root.notes.map(\.name).contains("Linked apple.md"))
        #expect(!library.root.attachments.map(\.name).contains("Linked apple.md"))
    }

    @Test func allNotes_counts_every_note_at_every_depth() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))

        // 4 at the root, 4 in alpha, 1 in Beta/Zeta.
        #expect(library.allNotes.count == 9)
        #expect(library.allNotes.map(\.title).contains("Deep Note"))
    }

    @Test func a_folders_allNotes_are_its_own_and_every_subfolders_in_tree_order() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))
        let beta = try #require(library.root.folders.first { $0.name == "Beta" })

        // Beta holds only an attachment itself; its one note is in Beta/Zeta.
        #expect(beta.notes.isEmpty)
        #expect(beta.allNotes.map(\.path) == ["Beta/Zeta/Deep Note.md"])
    }

    @Test func folders_come_before_files_and_each_list_is_in_natural_order() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))
        let alpha = try #require(library.root.folders.first)

        #expect(library.root.folders.map(\.name) == ["alpha", "Beta"])
        #expect(library.root.notes.map(\.title) == ["apple", "Banana", "Same Title", "Zed"])
        #expect(
            library.root.attachments.map(\.name) == ["chart 2.png", "Chart 10.png", "notes.txt"])
        #expect(alpha.notes.map(\.title) == ["Note 1", "Note 2", "Note 10", "Same Title"])
    }

    @Test func two_notes_with_the_same_title_in_different_folders_are_distinct_by_path() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))

        let sameTitle = library.allNotes.filter { $0.title == "Same Title" }
        #expect(sameTitle.map(\.path) == ["Same Title.md", "alpha/Same Title.md"])
        #expect(sameTitle.map(\.name) == ["Same Title.md", "Same Title.md"])
        #expect(Set(sameTitle).count == 2)
    }

    @Test func modifiedAt_is_the_files_modification_date() throws {
        let copy = try Fixtures.temporaryCopy(of: "scan-rules")
        defer { try? FileManager.default.removeItem(at: copy) }
        let knownDate = Date(timeIntervalSince1970: 1_700_000_000)  // 2023-11-14 22:13:20 UTC
        try FileManager.default.setAttributes(
            [.modificationDate: knownDate], ofItemAtPath: copy.appending(path: "Banana.md").path)

        let library = try Library.open(at: copy)

        let banana = try #require(library.root.notes.first { $0.title == "Banana" })
        #expect(banana.modifiedAt == knownDate)
    }

    @Test func read_returns_a_notes_full_text_frontmatter_included() throws {
        let library = try Library.open(at: Fixtures.library("scan-rules"))
        let apple = try #require(library.root.notes.first { $0.title == "apple" })

        let text = try library.read(apple)

        #expect(
            text == """
                ---
                title: Apple
                tags: [fruit]
                ---
                # apple

                Read byte-for-byte, frontmatter included.

                """)
    }

    @Test func reading_a_note_removed_after_the_scan_throws_noteMissing() throws {
        let copy = try Fixtures.temporaryCopy(of: "scan-rules")
        defer { try? FileManager.default.removeItem(at: copy) }
        let library = try Library.open(at: copy)
        let banana = try #require(library.root.notes.first { $0.title == "Banana" })
        try FileManager.default.removeItem(at: copy.appending(path: "Banana.md"))

        #expect(throws: LibraryError.noteMissing) {
            try library.read(banana)
        }
    }

    @Test func reading_a_note_without_permission_throws_unreadable() throws {
        let copy = try Fixtures.temporaryCopy(of: "scan-rules")
        defer { try? FileManager.default.removeItem(at: copy) }
        let library = try Library.open(at: copy)
        let banana = try #require(library.root.notes.first { $0.title == "Banana" })
        let noPermissions = 0o000
        try FileManager.default.setAttributes(
            [.posixPermissions: noPermissions], ofItemAtPath: copy.appending(path: "Banana.md").path
        )

        #expect(throws: LibraryError.unreadable) {
            try library.read(banana)
        }
    }

    @Test func an_obsidian_vault_opens_as_it_is_on_disk() throws {
        let vault = try Fixtures.library("obsidian-vault")
        // The fixture is only real once Obsidian has written its folder into it.
        try #require(
            FileManager.default.fileExists(atPath: vault.appending(path: ".obsidian").path))

        let library = try Library.open(at: vault)

        // Reading List, Scratch, Welcome; Daily/2026-09-13, Daily/Journal;
        // Projects/Vitrine; Topics/Agents, Alignment, Interpretability, Journal,
        // Scratch.
        #expect(library.allNotes.count == 11)
        #expect(library.root.folders.map(\.name) == ["Daily", "Projects", "Topics"])
        #expect(!library.root.folders.map(\.name).contains(".obsidian"))
        #expect(library.root.folders.flatMap(\.attachments).map(\.name) == ["sketch.png"])
        #expect(library.root.attachments.isEmpty)
    }
}
