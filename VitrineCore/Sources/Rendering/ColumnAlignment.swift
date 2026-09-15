/// How a table column aligns its cells, from the delimiter row's colons.
public enum ColumnAlignment: Sendable, Equatable {
    /// `:---`.
    case left
    /// `:---:`.
    case center
    /// `---:`.
    case right
}
