import Fixtures
import Foundation
import Library
import LibraryWatcher
import Testing

@Suite(.timeLimit(.minutes(1))) struct LibraryWatcherTests {
    /// The most a test waits for the first change it expects. Generous on
    /// purpose: a busy CI runner reports a file event seconds late, and a
    /// test that expects a change pays this only when it never comes.
    private static let deadline: Duration = .seconds(5)
    /// How long after a change the rest of its batch is given to arrive.
    /// The watcher coalesces within 100 ms (ADR 0014), so this is ample.
    private static let quiet: Duration = .milliseconds(300)
    /// The period in which a test that expects no change must see none.
    /// There is nothing to wait for, so this is the whole of its wait.
    private static let settling: Duration = .seconds(1)

    /// The changes the watcher reports for what the test just did: the
    /// first within `deadline`, then whatever else lands in the `quiet`
    /// period after it; empty when nothing arrives in time.
    private func changes(from stream: AsyncStream<LibraryChange>) async -> [LibraryChange] {
        await collect(from: stream, firstWithin: Self.deadline, thenFor: Self.quiet)
    }

    /// Every change the watcher reports in the next `settling` period, for
    /// the tests that expect none.
    private func changesInSettlingPeriod(from stream: AsyncStream<LibraryChange>) async
        -> [LibraryChange]
    {
        await collect(from: stream, firstWithin: Self.settling, thenFor: .zero)
    }

    private func collect(
        from stream: AsyncStream<LibraryChange>, firstWithin deadline: Duration,
        thenFor quiet: Duration
    ) async -> [LibraryChange] {
        let (arrivals, arrival) = AsyncStream<Void>.makeStream()
        let consumer = Task {
            var collected: [LibraryChange] = []
            for await change in stream {
                collected.append(change)
                arrival.yield()
            }
            arrival.finish()
            return collected
        }
        let arrivedInTime = await withTaskGroup(of: Bool.self) { group in
            group.addTask { await arrivals.first { _ in true } != nil }
            group.addTask {
                try? await Task.sleep(for: deadline)
                return false
            }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
        if arrivedInTime { try? await Task.sleep(for: quiet) }
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

        #expect(await changesInSettlingPeriod(from: stream) == [])
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

        #expect(await changesInSettlingPeriod(from: stream) == [])
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
