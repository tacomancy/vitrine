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
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false)[...]
        guard let first = lines.popFirst(), first == delimiter else { return nil }
        var yaml: [Substring] = []
        var closingEnd = first.utf8.count
        for line in lines {
            closingEnd += 1 + line.utf8.count  // the newline before this line, then the line
            if line == delimiter {
                // Obsidian treats a block whose YAML does not parse as no
                // frontmatter at all; the whole text is then body.
                let root: Node?
                do { root = try Yams.compose(yaml: yaml.joined(separator: "\n")) } catch {
                    return nil
                }
                return Frontmatter(
                    rawRange: 0..<closingEnd,
                    tags: values(under: ["tags", "tag"], in: root),
                    aliases: values(under: ["aliases", "alias"], in: root))
            }
            yaml.append(line)
        }
        return nil
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
