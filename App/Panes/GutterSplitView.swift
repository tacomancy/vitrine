import AppKit

/// An `NSSplitView` whose divider is a transparent gutter: draggable, drawn
/// as nothing (ADR 0008, Update). `HSplitView` cannot hide its divider and
/// `NavigationSplitView` swallows the drawn title bar; this is the fallback
/// the prototype settled on.
final class GutterSplitView: NSSplitView {
    private let gutter: CGFloat
    private var pendingWidths: [CGFloat]?

    /// `initialWidths` are the leading panes' widths, applied once; the last
    /// pane gets whatever is left.
    init(gutter: CGFloat, initialWidths: [CGFloat]) {
        self.gutter = gutter
        self.pendingWidths = initialWidths
        super.init(frame: .zero)
        isVertical = true
        dividerStyle = .thin
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var dividerThickness: CGFloat { gutter }

    override func drawDivider(in rect: NSRect) {}

    // Widths only stick once the view has a real width, so the initial ones
    // are placed on the first real layout, not from `updateNSView`, and never
    // again; the delegate keeps them through later resizes (ADR 0008, Update).
    override func layout() {
        super.layout()
        guard let widths = pendingWidths, bounds.width > 0 else { return }
        pendingWidths = nil
        var leadingEdge: CGFloat = 0
        for (pane, width) in zip(arrangedSubviews, widths) {
            pane.frame = NSRect(x: leadingEdge, y: 0, width: width, height: bounds.height)
            leadingEdge += width + gutter
        }
        if let last = arrangedSubviews.last {
            last.frame = NSRect(
                x: leadingEdge, y: 0, width: bounds.width - leadingEdge, height: bounds.height)
        }
    }
}
