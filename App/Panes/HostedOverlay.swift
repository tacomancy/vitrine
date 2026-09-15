import AppKit
import SwiftUI

/// SwiftUI content hosted in its own `NSHostingView`, for drawing over the
/// window's AppKit panes. SwiftUI paints its own views beneath every
/// platform view in the same host, so a plain overlay would sit under the
/// gutter split view; platform views keep tree order among themselves,
/// and this one comes last. It takes the window's key focus as it
/// appears, so the content's own focus — the palette's query field —
/// lands in it rather than staying with whatever the window had.
struct HostedOverlay<Content: View>: NSViewRepresentable {
    @ViewBuilder let content: () -> Content

    func makeNSView(context: Context) -> KeyHostingView<Content> {
        let hosting = KeyHostingView(rootView: content())
        // The overlay takes the size it is given; its content must not size
        // the window.
        hosting.sizingOptions = []
        return hosting
    }

    func updateNSView(_ hosting: KeyHostingView<Content>, context: Context) {
        hosting.rootView = content()
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize, nsView: KeyHostingView<Content>, context: Context
    ) -> CGSize? {
        proposal.replacingUnspecifiedDimensions(by: .zero)
    }
}

/// An `NSHostingView` that becomes its window's first responder on arrival.
final class KeyHostingView<Content: View>: NSHostingView<Content> {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }
}
