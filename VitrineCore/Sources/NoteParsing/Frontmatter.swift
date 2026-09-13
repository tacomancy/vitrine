import Foundation
import Yams

/// The YAML block at the very top of a note, kept as written (ADR 0011).
public struct Frontmatter: Sendable, Equatable {
    /// The whole block as UTF-8 offsets into the note, both `---` lines
    /// included — what an edit writes back untouched (ADR 0011).
    public let rawRange: Range<Int>
    /// The tags under `tags:` (or Obsidian's older `tag:`), in the order
    /// written, each without a leading `#`.
    public let tags: [String]
    /// The alternate titles under `aliases:` (or `alias:`), in the order
    /// written.
    public let aliases: [String]

    /// Obsidian recognises frontmatter only when the first line is exactly
    /// this and a later line is exactly this again.
    private static let delimiter = "---"

    /// The frontmatter of `text`, or nil when `text` does not begin with a
    /// closed `---` block.
    static func read(from text: String) -> Frontmatter? {
        // Split on scalars, not characters: Swift reads "\r\n" as one
        // character, which a split on "\n" would never find.
        var lines = text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false)[
            ...]
        guard let first = lines.popFirst(), isDelimiter(first) else { return nil }
        var yaml: [String] = []
        var lineStart = first.count + 1  // UTF-8 offset; the delimiter is ASCII
        for line in lines {
            if isDelimiter(line) {
                // Obsidian treats a block whose YAML does not parse as no
                // frontmatter at all; the whole text is then body.
                // Not `try?`: an empty block composes to nil and is still
                // frontmatter, while a parse failure is not.
                let root: Node?
                do { root = try Yams.compose(yaml: yaml.joined(separator: "\n")) } catch {
                    return nil
                }
                return Frontmatter(
                    rawRange: 0..<(lineStart + delimiter.utf8.count),
                    tags: values(under: ["tags", "tag"], in: root),
                    aliases: values(under: ["aliases", "alias"], in: root))
            }
            let content = String(line)
            yaml.append(content)
            lineStart += content.utf8.count + 1
        }
        return nil
    }

    /// A line is a delimiter with or without the `\r` of a Windows line
    /// ending; Obsidian reads CRLF vaults the same as LF ones.
    private static func isDelimiter(_ line: Substring.UnicodeScalarView) -> Bool {
        line.elementsEqual(delimiter.unicodeScalars)
            || line.elementsEqual((delimiter + "\r").unicodeScalars)
    }

    /// Obsidian accepts a list, a single string, or one comma-separated
    /// string under any of `keys`; a leading `#` is not part of a value.
    private static func values(under keys: [String], in root: Node?) -> [String] {
        // ADR 0011: read as strings, never decode — `yes` must stay "yes".
        let node = keys.lazy.compactMap { root?[$0] }.first
        let scalars: [String]
        switch node {
        case .sequence(let sequence):
            scalars = sequence.compactMap { $0.scalar?.string }
        case .scalar(let scalar):
            scalars = scalar.string.split(separator: ",").map(String.init)
        case .mapping, .alias, nil:
            scalars = []
        }
        return
            scalars
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .map { $0.hasPrefix("#") ? String($0.dropFirst()) : $0 }
            .filter { !$0.isEmpty }
    }
}
