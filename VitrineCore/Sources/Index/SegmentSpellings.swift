/// Each tag segment's display spelling, settled as the library is read:
/// the first spelling of a segment seen wins, for every tag that contains
/// it (CONTEXT.md § Tags).
struct SegmentSpellings {
    /// Display spelling by lowercased segment.
    private var spellings: [String: String] = [:]

    /// The display spelling of `segment`, recording `segment` itself as that
    /// spelling when it is the first seen.
    mutating func spelling(of segment: Substring) -> String {
        let identity = segment.lowercased()
        if let recorded = spellings[identity] { return recorded }
        spellings[identity] = String(segment)
        return String(segment)
    }
}
