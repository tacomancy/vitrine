/// One tag taken apart into its segments (CONTEXT.md § Tags): `#parent/child`
/// is the segments `parent` and `child`, each a topic with its own identity
/// and display spelling. Two tags with one identity have one spelling, so
/// equality is identity.
struct TagPath: Equatable, Sendable {
    /// The segments in order, root first. Never empty.
    let segments: [TagSegment]
    /// The whole tag lowercased, segments joined by `/` — its identity, and a
    /// `TagTreeNode`'s `path`.
    let identity: String
    /// The tag as displayed: each segment's display spelling, joined by `/`.
    let displaySpelling: String

    /// Takes `spelling` — a tag as written, without its `#` — apart,
    /// settling each segment's display spelling in `spellings`. An empty
    /// segment is no segment: `a//b` is `a/b`, and a tag with no segments at
    /// all (`/`) is nil.
    init?(_ spelling: String, spellings: inout SegmentSpellings) {
        let segments = spelling.split(separator: Self.separator).map { segment in
            TagSegment(identity: segment.lowercased(), name: spellings.spelling(of: segment))
        }
        guard !segments.isEmpty else { return nil }
        self.segments = segments
        identity = Self.joined(segments.map(\.identity))
        displaySpelling = Self.joined(segments.map(\.name))
    }

    /// Whether a note carrying this tag is counted under the tag whose
    /// segment identities are `ancestry`: this tag is it, or descends from
    /// it. An empty `ancestry` is no tag and counts nothing.
    func isCounted(under ancestry: [String]) -> Bool {
        !ancestry.isEmpty && segments.map(\.identity).starts(with: ancestry)
    }

    /// The character between segments as written.
    private static let separator: Character = "/"

    /// The segment identities a tag spelled `spelling` would have, so a query
    /// is taken apart the same way the tags were.
    static func segmentIdentities(of spelling: String) -> [String] {
        spelling.split(separator: separator).map { $0.lowercased() }
    }

    /// Segment identities, or spellings, written back as one tag.
    static func joined(_ segments: [String]) -> String {
        segments.joined(separator: String(separator))
    }
}
