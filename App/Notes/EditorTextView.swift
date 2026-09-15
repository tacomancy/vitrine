import AppKit

/// The editor's `NSTextView` (ADR 0013): it reports taking and giving up
/// keyboard focus — the brass ring is SwiftUI's to draw — and holds its
/// lines to a measure, following the view's width only up to it.
final class EditorTextView: NSTextView {
    var onFocusChange: ((Bool) -> Void)?
    /// The widest a line may run, in points.
    var measure: CGFloat = .greatestFiniteMagnitude {
        didSet { fitContainer() }
    }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { onFocusChange?(true) }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let accepted = super.resignFirstResponder()
        if accepted { onFocusChange?(false) }
        return accepted
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        fitContainer()
    }

    // The container does not track the view's width itself, so the measure
    // can cap it; it is set by hand when the width changes — and only then,
    // since setting it invalidates the whole layout, which the view's own
    // height changes would otherwise do on every edit.
    private func fitContainer() {
        guard let textContainer else { return }
        let width = min(frame.width - textContainerInset.width * 2, measure)
        guard textContainer.size.width != width else { return }
        textContainer.size.width = width
    }
}
