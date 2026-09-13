import AppKit
import SwiftUI

/// The three floating panes of the Notes tab in a `GutterSplitView`. The
/// delegate owns the widths: drags stay within each pane's min and max, and
/// window resizes go to the editor, which gives way to nothing until the
/// others are at their minimums.
struct GutterSplitPanes: NSViewRepresentable {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> GutterSplitView {
        let split = GutterSplitView(
            gutter: ShellMetrics.gutter, initialWidths: PaneWidth.all.compactMap(\.ideal))
        split.delegate = context.coordinator
        let panes = [
            host(Sidebar(currentLibrary: currentLibrary, selection: selection)),
            host(NoteList(currentLibrary: currentLibrary, selection: selection)),
            host(Editor(currentLibrary: currentLibrary, selection: selection)),
        ]
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

    private func host(_ view: some View) -> NSView {
        let hosting = NSHostingView(rootView: view)
        // The panes take the width the split view gives them; a pane's own
        // content must not size the split view (and so the window) upward.
        hosting.sizingOptions = []
        return hosting
    }

    /// Divider `i` sits between panes `i` and `i + 1`; a divider's position
    /// is measured from the split view's leading edge.
    final class Coordinator: NSObject, NSSplitViewDelegate {
        private let widths = PaneWidth.all

        func splitView(
            _ splitView: NSSplitView, constrainMinCoordinate proposedMinimumPosition: CGFloat,
            ofSubviewAt dividerIndex: Int
        ) -> CGFloat {
            let leadingEdge = splitView.arrangedSubviews[dividerIndex].frame.minX
            return max(proposedMinimumPosition, leadingEdge + widths[dividerIndex].minimum)
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

        // The last pane takes the rest. When the rest is below its minimum,
        // the panes before it give up width, last first, down to their own.
        func splitView(_ splitView: NSSplitView, resizeSubviewsWithOldSize oldSize: NSSize) {
            let panes = splitView.arrangedSubviews
            let last = panes.indices.last ?? 0
            var paneWidths = panes.map(\.frame.width)
            let gutters = splitView.dividerThickness * CGFloat(last)
            paneWidths[last] =
                splitView.bounds.width - gutters - paneWidths.dropLast().reduce(0, +)
            for index in stride(from: last - 1, through: 0, by: -1) {
                let shortfall = widths[last].minimum - paneWidths[last]
                guard shortfall > 0 else { break }
                let surrender = min(shortfall, paneWidths[index] - widths[index].minimum)
                paneWidths[index] -= surrender
                paneWidths[last] += surrender
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
