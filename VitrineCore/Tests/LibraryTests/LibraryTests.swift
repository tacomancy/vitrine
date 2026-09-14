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
        #expect(
            LibraryError.unwritable.localizedDescription
                == "Vitrine can’t write it. Check its permissions and try again.")
        #expect(
            LibraryError.invalidName.localizedDescription
                == "A note’s title can’t be empty or contain a slash.")
        #expect(
            LibraryError.nameTaken.localizedDescription
                == "A note with that title is already in this folder.")
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

    // MARK: Writing

    @Test func write_then_read_returns_the_same_bytes_and_the_file_keeps_its_inode() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let welcome = try #require(library.root.notes.first { $0.title == "Welcome" })
        let file = copy.appending(path: "Welcome.md")
        let inodeBefore = try #require(
            file.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier)
        let text = "---\ntitle: Welcome\n---\n# Welcome\n\nRewritten, ünïcödé and all. 🎉\n"

        try library.write(text, to: welcome)

        #expect(try library.read(welcome) == text)
        let inodeAfter = try #require(
            file.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier)
        #expect(inodeAfter.isEqual(inodeBefore))
    }

    @Test func a_note_with_crlf_line_endings_keeps_them_after_a_write_of_the_same_text() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let scratch = try #require(library.root.notes.first { $0.title == "Scratch" })
        let windowsText = "# Scratch\r\n\r\nWritten on Windows.\r\n"
        try library.write(windowsText, to: scratch)

        try library.write(try library.read(scratch), to: scratch)

        #expect(try library.read(scratch) == windowsText)
        #expect(try Array(library.read(scratch).utf8) == Array(windowsText.utf8))
    }

    @Test func write_refreshes_the_notes_modifiedAt_in_the_tree() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let welcome = try #require(library.root.notes.first { $0.title == "Welcome" })

        try library.write("# Welcome\n", to: welcome)

        let refreshed = try #require(library.root.notes.first { $0.title == "Welcome" })
        #expect(refreshed.modifiedAt > welcome.modifiedAt)
        #expect(refreshed.path == welcome.path)
        #expect(library.allNotes.count == 11)
    }

    // MARK: Creating

    @Test func createNote_creates_an_empty_md_in_the_folder_and_places_it_in_display_order() throws
    {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let topics = try #require(library.root.folders.first { $0.name == "Topics" })

        let created = try library.createNote(named: "Circuits", in: topics)

        #expect(created.name == "Circuits.md")
        #expect(created.path == "Topics/Circuits.md")
        #expect(created.title == "Circuits")
        #expect(try library.read(created) == "")
        let refreshed = try #require(library.root.folders.first { $0.name == "Topics" })
        #expect(
            refreshed.notes.map(\.title)
                == ["Agents", "Alignment", "Circuits", "Interpretability", "Journal", "Scratch"])
        #expect(refreshed.notes.contains(created))
        #expect(library.allNotes.count == 12)
    }

    @Test func uniqueUntitledName_yields_Untitled_then_Untitled_1_then_Untitled_2() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)

        #expect(library.uniqueUntitledName(in: library.root) == "Untitled")
        _ = try library.createNote(named: "Untitled", in: library.root)
        #expect(library.uniqueUntitledName(in: library.root) == "Untitled 1")
        _ = try library.createNote(named: "Untitled 1", in: library.root)
        #expect(library.uniqueUntitledName(in: library.root) == "Untitled 2")
        // The folder is what counts: Topics has no Untitled yet.
        let topics = try #require(library.root.folders.first { $0.name == "Topics" })
        #expect(library.uniqueUntitledName(in: topics) == "Untitled")
    }

    @Test func createNote_refuses_an_empty_name_with_invalidName() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)

        #expect(throws: LibraryError.invalidName) {
            try library.createNote(named: "", in: library.root)
        }
        #expect(library.allNotes.count == 11)
    }

    @Test func createNote_refuses_a_name_containing_a_slash_with_invalidName() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)

        #expect(throws: LibraryError.invalidName) {
            try library.createNote(named: "Topics/Circuits", in: library.root)
        }
        #expect(library.allNotes.count == 11)
    }

    @Test func createNote_refuses_an_existing_title_case_insensitively_with_nameTaken() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let topics = try #require(library.root.folders.first { $0.name == "Topics" })

        #expect(throws: LibraryError.nameTaken) {
            try library.createNote(named: "agents", in: topics)
        }
        // A title is taken per folder: the root has no Agents.
        #expect(throws: Never.self) {
            try library.createNote(named: "agents", in: library.root)
        }
    }

    // MARK: Renaming

    @Test func renameNote_renames_the_file_within_its_folder() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let agents = try #require(library.allNotes.first { $0.path == "Topics/Agents.md" })
        let textBefore = try library.read(agents)

        let renamed = try library.renameNote(agents, to: "Multi-agent systems")

        #expect(renamed.path == "Topics/Multi-agent systems.md")
        #expect(renamed.name == "Multi-agent systems.md")
        #expect(renamed.title == "Multi-agent systems")
        #expect(try library.read(renamed) == textBefore)
        let topics = try #require(library.root.folders.first { $0.name == "Topics" })
        #expect(
            topics.notes.map(\.title)
                == ["Alignment", "Interpretability", "Journal", "Multi-agent systems", "Scratch"])
        #expect(throws: LibraryError.noteMissing) { try library.read(agents) }
    }

    @Test func renameNote_refuses_the_same_titles_createNote_does() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let agents = try #require(library.allNotes.first { $0.path == "Topics/Agents.md" })

        #expect(throws: LibraryError.invalidName) { try library.renameNote(agents, to: "") }
        #expect(throws: LibraryError.invalidName) { try library.renameNote(agents, to: "a/b") }
        #expect(throws: LibraryError.nameTaken) { try library.renameNote(agents, to: "ALIGNMENT") }
        #expect(library.allNotes.map(\.path).contains("Topics/Agents.md"))
    }

    @Test func renameNote_leaves_the_text_of_notes_linking_to_it_untouched() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let welcome = try #require(library.root.notes.first { $0.title == "Welcome" })
        let linking = try #require(library.allNotes.first { $0.path == "Projects/Vitrine.md" })
        let linkingTextBefore = try library.read(linking)

        _ = try library.renameNote(welcome, to: "Start here")

        // The parked rename feature would rewrite [[Welcome]]; this one must not.
        #expect(try library.read(linking) == linkingTextBefore)
        #expect(linkingTextBefore.contains("[[Welcome]]"))
    }

    // MARK: Applying changes made by another tool

    @Test func applying_entryAdded_shows_a_note_another_tool_created() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        try OtherTool.write("# Circuits\n", to: copy.appending(path: "Topics/Circuits.md"))

        let applied = library.applying(.entryAdded("Topics/Circuits.md"))

        let topics = try #require(applied.root.folders.first { $0.name == "Topics" })
        #expect(
            topics.notes.map(\.title)
                == ["Agents", "Alignment", "Circuits", "Interpretability", "Journal", "Scratch"])
        #expect(applied.allNotes.count == 12)
        #expect(library.allNotes.count == 11)
    }

    @Test func applying_entryRemoved_drops_a_note_another_tool_removed() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        try OtherTool.remove(copy.appending(path: "Topics/Agents.md"))

        let applied = library.applying(.entryRemoved("Topics/Agents.md"))

        let topics = try #require(applied.root.folders.first { $0.name == "Topics" })
        #expect(
            topics.notes.map(\.title) == ["Alignment", "Interpretability", "Journal", "Scratch"])
        #expect(applied.allNotes.count == 10)
    }

    @Test func applying_entryRenamed_moves_a_note_another_tool_renamed_across_folders() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        try OtherTool.rename(
            copy.appending(path: "Topics/Agents.md"), to: copy.appending(path: "Daily/Agents.md"))

        let applied = library.applying(
            .entryRenamed(from: "Topics/Agents.md", to: "Daily/Agents.md"))

        let topics = try #require(applied.root.folders.first { $0.name == "Topics" })
        let daily = try #require(applied.root.folders.first { $0.name == "Daily" })
        #expect(
            topics.notes.map(\.title) == ["Alignment", "Interpretability", "Journal", "Scratch"])
        #expect(daily.notes.map(\.title) == ["2026-09-13", "Agents", "Journal"])
        #expect(applied.allNotes.count == 11)
    }

    @Test func applying_noteModified_refreshes_the_notes_modifiedAt() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let welcome = try #require(library.root.notes.first { $0.title == "Welcome" })
        try OtherTool.append("\nA line from Obsidian.\n", to: copy.appending(path: "Welcome.md"))

        let applied = library.applying(.noteModified("Welcome.md"))

        let refreshed = try #require(applied.root.notes.first { $0.title == "Welcome" })
        #expect(refreshed.modifiedAt > welcome.modifiedAt)
        #expect(applied.root.notes.map(\.title) == ["Reading List", "Scratch", "Welcome"])
    }

    @Test func applying_folderChanged_scans_that_folder_again() throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        try OtherTool.write("", to: copy.appending(path: "Topics/Circuits.md"))
        try OtherTool.remove(copy.appending(path: "Topics/Agents.md"))
        try OtherTool.write("", to: copy.appending(path: "Untitled.md"))

        let applied = library.applying(.folderChanged("Topics"))

        let topics = try #require(applied.root.folders.first { $0.name == "Topics" })
        #expect(
            topics.notes.map(\.title) == [
                "Alignment", "Circuits", "Interpretability", "Journal", "Scratch",
            ]
        )
        // Only Topics was scanned; the root's new note waits for its own change.
        #expect(applied.root.notes.map(\.title) == ["Reading List", "Scratch", "Welcome"])
        #expect(applied.applying(.folderChanged("")).allNotes.count == 12)
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
