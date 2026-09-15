import AppKit
import SwiftUI

/// A tab's floating panes in a `GutterSplitView`, each hosted on its own.
/// The delegate owns the widths: drags stay within each pane's min and
/// max, and window resizes go to the flexible pane, which gives way to
/// nothing until the others are at their minimums.
struct GutterSplitPanes: NSViewRepresentable {
    /// The panes' widths, leading to trailing — one per pane `makePanes`
    /// returns.
    let widths: [PaneWidth]
    /// Builds the panes, once, when the split view is made; a pane's
    /// content follows the observable state it was given, not this view.
    let makePanes: () -> [NSView]

    func makeCoordinator() -> Coordinator {
        Coordinator(widths: widths)
    }

    func makeNSView(context: Context) -> GutterSplitView {
        let split = GutterSplitView(gutter: ShellMetrics.gutter, initialWidths: widths.map(\.ideal))
        split.delegate = context.coordinator
        let panes = makePanes()
        // The delegate indexes the width table by pane; a table of the
        // wrong length would fail there, later and less clearly.
        precondition(panes.count == widths.count, "One PaneWidth per pane")
        for pane in panes {
            split.addArrangedSubview(pane)
        }
        return split
    }

    func updateNSView(_ split: GutterSplitView, context: Context) {}

    // The split view fills whatever it is offered; left to its own fitting
    // size it would ask for the whole screen and the window would follow.
    func sizeThatFits(
        _ proposal: ProposedViewSize, nsView: GutterSplitView, context: Context
    ) -> CGSize? {
        proposal.replacingUnspecifiedDimensions(by: .zero)
    }

    /// `view` as a pane: hosted, taking the width the split view gives it.
    static func host(_ view: some View) -> NSView {
        let hosting = NSHostingView(rootView: view)
        // A pane's own content must not size the split view (and so the
        // window) upward.
        hosting.sizingOptions = []
        return hosting
    }

    /// Divider `i` sits between panes `i` and `i + 1`; a divider's position
    /// is measured from the split view's leading edge. Moving it one way
    /// shrinks pane `i` and grows pane `i + 1`, so each bound is the tighter
    /// of the two panes' limits.
    final class Coordinator: NSObject, NSSplitViewDelegate {
        private let widths: [PaneWidth]
        private let flexible: Int

        init(widths: [PaneWidth]) {
            self.widths = widths
            self.flexible = widths.flexible
        }

        func splitView(
            _ splitView: NSSplitView, constrainMinCoordinate proposedMinimumPosition: CGFloat,
            ofSubviewAt dividerIndex: Int
        ) -> CGFloat {
            let leadingEdge = splitView.arrangedSubviews[dividerIndex].frame.minX
            let nextTrailingEdge = splitView.arrangedSubviews[dividerIndex + 1].frame.maxX
            return max(
                proposedMinimumPosition,
                leadingEdge + widths[dividerIndex].minimum,
                nextTrailingEdge - widths[dividerIndex + 1].maximum - splitView.dividerThickness)
        }

        func splitView(
            _ splitView: NSSplitView, constrainMaxCoordinate proposedMaximumPosition: CGFloat,
            ofSubviewAt dividerIndex: Int
        ) -> CGFloat {
            let leadingEdge = splitView.arrangedSubviews[dividerIndex].frame.minX
            let nextTrailingEdge = splitView.arrangedSubviews[dividerIndex + 1].frame.maxX
            return min(
                proposedMaximumPosition,
                leadingEdge + widths[dividerIndex].maximum,
                nextTrailingEdge - widths[dividerIndex + 1].minimum - splitView.dividerThickness)
        }

        // The flexible pane takes the rest. When the rest is below its
        // minimum, the other panes give up width — the trailing ones first —
        // down to their own.
        func splitView(_ splitView: NSSplitView, resizeSubviewsWithOldSize oldSize: NSSize) {
            let panes = splitView.arrangedSubviews
            var paneWidths = panes.map(\.frame.width)
            let gutters = splitView.dividerThickness * CGFloat(panes.count - 1)
            let others = panes.indices.filter { $0 != flexible }
            paneWidths[flexible] =
                splitView.bounds.width - gutters - others.map { paneWidths[$0] }.reduce(0, +)
            for index in others.reversed() {
                let shortfall = widths[flexible].minimum - paneWidths[flexible]
                guard shortfall > 0 else { break }
                let surrender = min(shortfall, paneWidths[index] - widths[index].minimum)
                paneWidths[index] -= surrender
                paneWidths[flexible] += surrender
            }
            var leadingEdge: CGFloat = 0
            for (pane, width) in zip(panes, paneWidths) {
                pane.frame = NSRect(
                    x: leadingEdge, y: 0, width: width, height: splitView.bounds.height)
                leadingEdge += width + splitView.dividerThickness
            }
        }
    }
}
