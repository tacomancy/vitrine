import CoreGraphics

/// The width a pane may take. The sidebar, note list, and rail have the
/// spec's min / ideal / max; the editor and the tag page have a minimum
/// only and take the rest.
struct PaneWidth {
    let minimum: CGFloat
    /// The width applied on first layout; `nil` for the pane that takes the rest.
    let ideal: CGFloat?
    let maximum: CGFloat

    static let sidebar = PaneWidth(minimum: 196, ideal: 212, maximum: 280)
    static let noteList = PaneWidth(minimum: 260, ideal: 300, maximum: 404)
    static let editor = PaneWidth(minimum: 320, ideal: nil, maximum: .infinity)
    static let rail = PaneWidth(minimum: 220, ideal: 260, maximum: 360)
    /// The tag page takes what the Tags tab's sidebar leaves, as the editor
    /// does on the Notes tab.
    static let tagPage = PaneWidth(minimum: 320, ideal: nil, maximum: .infinity)

    /// The Notes tab's panes, leading to trailing.
    static let notesTab = [sidebar, noteList, editor, rail]
    /// The Tags tab's panes, leading to trailing: the same sidebar width,
    /// then the tag page.
    static let tagsTab = [sidebar, tagPage]
}

extension [PaneWidth] {
    /// The index of the pane that takes the rest — the one with no ideal
    /// width. Exactly one pane must, or the split view could not lay the
    /// others out; a table without one stops the launch.
    var flexible: Int {
        guard let index = firstIndex(where: { $0.ideal == nil }) else {
            preconditionFailure("A pane table needs one pane with no ideal width")
        }
        return index
    }
}
