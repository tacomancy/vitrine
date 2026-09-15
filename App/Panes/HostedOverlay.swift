import AppKit
import SwiftUI

/// SwiftUI content hosted in its own `NSHostingView`, for drawing over the
/// window's AppKit panes. SwiftUI paints its own views beneath every
/// platform view in the same host, so a plain overlay would sit under the
/// gutter split view; platform views keep tree order among themselves,
/// and this one comes last.
struct HostedOverlay<Content: View>: NSViewRepresentable {
    @ViewBuilder let content: () -> Content

    func makeNSView(context: Context) -> NSHostingView<Content> {
        let hosting = NSHostingView(rootView: content())
        // The overlay takes the size it is given; its content must not size
        // the window.
        hosting.sizingOptions = []
        return hosting
    }

    func updateNSView(_ hosting: NSHostingView<Content>, context: Context) {
        hosting.rootView = content()
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize, nsView: NSHostingView<Content>, context: Context
    ) -> CGSize? {
        proposal.replacingUnspecifiedDimensions(by: .zero)
    }
}
