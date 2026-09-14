import Foundation

/// Any other tool changing the library while it is open (CONTEXT.md,
/// ADR 0014): Obsidian, Finder, a sync client. Every action runs in a
/// separate process, because the file system reports which process made
/// a change and the library must treat these as not its own.
public enum OtherTool {
    /// Writes `text` to the file at `url`, creating it if needed.
    public static func write(_ text: String, to url: URL) throws {
        try run("printf '%s' \"$1\" > \"$2\"", text, url.path)
    }

    /// Appends `text` to the file at `url`.
    public static func append(_ text: String, to url: URL) throws {
        try run("printf '%s' \"$1\" >> \"$2\"", text, url.path)
    }

    /// Appends `text` to the file at `url` `times` times in quick succession.
    public static func append(_ text: String, to url: URL, times: Int) throws {
        try run(
            "i=0; while [ $i -lt \"$3\" ]; do printf '%s' \"$1\" >> \"$2\"; i=$((i+1)); done",
            text, url.path, String(times))
    }

    /// Replaces the file at `url` with `text` the way TextEdit and many
    /// editors save: written to a sibling file first, then renamed over.
    public static func replace(_ url: URL, with text: String) throws {
        try run("printf '%s' \"$1\" > \"$2.sb-tmp\" && mv \"$2.sb-tmp\" \"$2\"", text, url.path)
    }

    /// Removes the file at `url`.
    public static func remove(_ url: URL) throws {
        try run("rm \"$1\"", url.path)
    }

    /// Renames the file at `url` to `destination`.
    public static func rename(_ url: URL, to destination: URL) throws {
        try run("mv \"$1\" \"$2\"", url.path, destination.path)
    }

    private static func run(_ script: String, _ arguments: String...) throws {
        let process = Process()
        process.executableURL = URL(filePath: "/bin/sh")
        process.arguments = ["-c", script, "sh"] + arguments
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw FixtureError.otherToolFailed(script) }
    }
}
