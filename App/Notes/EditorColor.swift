import AppKit

/// The one editor color that is not a token as it stands: the mockup's
/// selection wash, `primary` at 42 % (design/Vitrine.dc.html `::selection`).
enum EditorColor {
    static let selection = NSColor(resource: .primary).withAlphaComponent(0.42)
}
