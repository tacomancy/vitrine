import CoreGraphics

/// The width a pane may take. The sidebar and note list have the spec's
/// min / ideal / max; the editor has a minimum only and takes the rest.
struct PaneWidth {
    let minimum: CGFloat
    /// The width applied on first layout; `nil` for the pane that takes the rest.
    let ideal: CGFloat?
    let maximum: CGFloat

    static let sidebar = PaneWidth(minimum: 196, ideal: 212, maximum: 280)
    static let noteList = PaneWidth(minimum: 260, ideal: 300, maximum: 404)
    static let editor = PaneWidth(minimum: 320, ideal: nil, maximum: .infinity)

    /// In pane order, leading to trailing.
    static let all = [sidebar, noteList, editor]
}
