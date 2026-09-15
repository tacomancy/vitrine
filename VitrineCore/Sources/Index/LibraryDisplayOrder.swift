import Foundation

/// Library display order (CONTEXT.md, Index) read off two paths, so a
/// note the tree was scanned without can be placed among the ones it was:
/// a folder's own notes come before its subfolders', and every list is in
/// the file tree's case-insensitive natural order. Public for the seams
/// that keep notes in this order one change at a time as the Index does
/// (ADR 0017): Search adds a note where the Index would (ADR 0018).
public enum LibraryDisplayOrder {
    /// Whether the note at `path` comes before the one at `other`.
    public static func precedes(_ path: String, _ other: String) -> Bool {
        let segments = path.split(separator: "/")
        let otherSegments = other.split(separator: "/")
        for (segment, otherSegment) in zip(segments.dropLast(), otherSegments.dropLast())
        where segment != otherSegment {
            return isInNaturalOrder(segment, otherSegment)
        }
        // One folder's ancestry is the other's prefix: the shallower note's
        // folder is the deeper one's ancestor, and its notes come first.
        guard segments.count == otherSegments.count else {
            return segments.count < otherSegments.count
        }
        return isInNaturalOrder(segments[segments.count - 1], otherSegments[segments.count - 1])
    }

    /// Whether `name` comes before `other` in the file tree's order — and,
    /// where the two names order the same (`01`, `1`), whether `path`
    /// comes before `otherPath`, so every list is the same every build.
    static func precedes(_ name: String, _ other: String, thenBy path: String, _ otherPath: String)
        -> Bool
    {
        switch name.localizedStandardCompare(other) {
        case .orderedAscending: true
        case .orderedDescending: false
        case .orderedSame: path < otherPath
        }
    }

    /// Finder's and Obsidian's file order: case-insensitive, with digit runs
    /// compared as numbers, so `Note 2` precedes `Note 10`.
    private static func isInNaturalOrder(_ name: Substring, _ other: Substring) -> Bool {
        name.localizedStandardCompare(other) == .orderedAscending
    }
}
