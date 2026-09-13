import CoreGraphics

/// Fixed dimensions of the drawn window shell (ADR 0008; brief § Window shell).
enum ShellMetrics {
    static let titleBarHeight: CGFloat = 38
    static let tabStripHeight: CGFloat = 31
    /// The transparent gutter between and around the floating panes.
    static let gutter: CGFloat = 8
    /// Where the system traffic lights sit in a hidden-title-bar window; the
    /// drawn title bar starts its own content after them.
    static let trafficLightsWidth: CGFloat = 70
    static let markSize: CGFloat = 22
}
