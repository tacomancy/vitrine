import Fixtures
import Foundation
import Library
import LibraryWatcher
import Testing

@Suite(.timeLimit(.minutes(1))) struct LibraryWatcherTests {
    /// Long enough for the file system to report a change and the watcher to
    /// coalesce it; short enough that a suite of these stays quick.
    private static let settling: Duration = .seconds(1)

    /// Every change the watcher reports in the next `settling` period, after
    /// which the consuming task is cancelled.
    private func changes(from stream: AsyncStream<LibraryChange>) async -> [LibraryChange] {
        let consumer = Task {
            var collected: [LibraryChange] = []
            for await change in stream { collected.append(change) }
            return collected
        }
        try? await Task.sleep(for: Self.settling)
        consumer.cancel()
        return await consumer.value
    }

    @Test func modifying_a_note_with_another_tool_yields_one_noteModified() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.append("\nA line from Obsidian.\n", to: copy.appending(path: "Welcome.md"))

        #expect(await changes(from: stream) == [.noteModified("Welcome.md")])
    }

    @Test func creating_a_note_with_another_tool_yields_entryAdded() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.write("# Circuits\n", to: copy.appending(path: "Topics/Circuits.md"))

        #expect(await changes(from: stream) == [.entryAdded("Topics/Circuits.md")])
    }

    @Test func deleting_a_note_with_another_tool_yields_entryRemoved() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.remove(copy.appending(path: "Topics/Agents.md"))

        #expect(await changes(from: stream) == [.entryRemoved("Topics/Agents.md")])
    }

    @Test func renaming_a_note_with_another_tool_yields_entryRenamed() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.rename(
            copy.appending(path: "Topics/Agents.md"), to: copy.appending(path: "Daily/Agents.md"))

        #expect(
            await changes(from: stream) == [
                .entryRenamed(from: "Topics/Agents.md", to: "Daily/Agents.md")
            ])
    }

    @Test func replacing_a_note_by_writing_a_sibling_then_renaming_over_yields_noteModified()
        async throws
    {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.replace(copy.appending(path: "Welcome.md"), with: "# Saved by TextEdit\n")

        #expect(await changes(from: stream) == [.noteModified("Welcome.md")])
    }

    @Test func replacing_an_attachment_the_same_way_yields_attachmentModified() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.replace(copy.appending(path: "Projects/sketch.png"), with: "new bytes")

        #expect(await changes(from: stream) == [.attachmentModified("Projects/sketch.png")])
    }

    @Test func modifying_an_attachment_with_another_tool_yields_attachmentModified() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.append("not really PNG", to: copy.appending(path: "Projects/sketch.png"))

        #expect(await changes(from: stream) == [.attachmentModified("Projects/sketch.png")])
    }

    @Test func a_write_through_the_library_yields_no_change() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let welcome = try #require(library.root.notes.first { $0.title == "Welcome" })
        let stream = LibraryWatcher.watch(library)

        try library.write("# Welcome\n\nVitrine's own save.\n", to: welcome)
        let untitled = try library.createNote(named: "Untitled", in: library.root)
        _ = try library.renameNote(untitled, to: "Named")

        #expect(await changes(from: stream) == [])
    }

    @Test func deleting_with_another_tool_a_note_the_library_created_yields_entryRemoved()
        async throws
    {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        var library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)
        let untitled = try library.createNote(named: "Untitled", in: library.root)
        let named = try library.renameNote(untitled, to: "Named")
        // Long enough that the library's own doing has been reported and
        // dropped before another tool's is reported.
        try await Task.sleep(for: Self.settling)

        try OtherTool.remove(copy.appending(path: named.path))

        #expect(await changes(from: stream) == [.entryRemoved("Named.md")])
    }

    @Test func writes_under_dot_entries_yield_no_change() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.write("{}", to: copy.appending(path: ".obsidian/workspace.json"))
        try OtherTool.write("", to: copy.appending(path: ".DS_Store"))
        try OtherTool.write("", to: copy.appending(path: "Topics/.hidden.md"))

        #expect(await changes(from: stream) == [])
    }

    @Test func several_rapid_modifications_to_one_note_coalesce_into_one_change() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)

        try OtherTool.append("x", to: copy.appending(path: "Welcome.md"), times: 20)

        #expect(await changes(from: stream) == [.noteModified("Welcome.md")])
    }

    @Test func cancelling_the_consuming_task_ends_the_stream() async throws {
        let copy = try Fixtures.temporaryCopy(of: "obsidian-vault")
        defer { Fixtures.discard(copy) }
        let library = try Library.open(at: copy)
        let stream = LibraryWatcher.watch(library)
        let consumer = Task {
            var count = 0
            for await _ in stream { count += 1 }
            return count
        }

        consumer.cancel()

        // The loop above returns only once the stream has ended.
        #expect(await consumer.value == 0)
    }
}
