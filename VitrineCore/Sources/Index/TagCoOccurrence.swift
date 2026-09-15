/// One tag that a tag's notes also carry, and how many of them do
/// (CONTEXT.md § Tag page): the tag page's CO-OCCURS WITH row, `6/14`.
public struct TagCoOccurrence: Sendable, Equatable {
    /// The other tag in display spelling, without its `#` — as `tags(of:)`
    /// spells it.
    public let tag: String
    /// How many of the tag's notes carry `tag` or a tag under it, each note
    /// once.
    public let count: Int
    /// How many notes carry the tag whose co-occurrence this is: the bar's
    /// full width.
    public let outOf: Int

    /// Memberwise, so a test's expected value can build one directly.
    public init(tag: String, count: Int, outOf: Int) {
        self.tag = tag
        self.count = count
        self.outOf = outOf
    }
}
