import AppKit
import SwiftUI

/// The four floating panes of the Notes tab in a `GutterSplitView`. The
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
            gutter: ShellMetrics.gutter, initialWidths: PaneWidth.all.map(\.ideal))
        split.delegate = context.coordinator
        let panes = [
            host(Sidebar(currentLibrary: currentLibrary, selection: selection)),
            host(NoteList(currentLibrary: currentLibrary, selection: selection)),
            host(Editor(currentLibrary: currentLibrary, selection: selection)),
            host(Rail(currentLibrary: currentLibrary, selection: selection)),
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
    /// is measured from the split view's leading edge. Moving it one way
    /// shrinks pane `i` and grows pane `i + 1`, so each bound is the tighter
    /// of the two panes' limits.
    final class Coordinator: NSObject, NSSplitViewDelegate {
        private let widths = PaneWidth.all
        /// The pane that takes whatever the others leave: the editor.
        private let flexible = PaneWidth.all.firstIndex { $0.ideal == nil } ?? 0

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

        // The editor takes the rest. When the rest is below its minimum, the
        // other panes give up width — the rail, then the note list, then the
        // sidebar — down to their own.
        func splitView(_ splitView: NSSplitView, resizeSubviewsWithOldSize oldSize: NSSize) {
            let panes = splitView.arrangedSubviews
            var paneWidths = panes.map(\.frame.width)
            let gutters = splitView.dividerThickness * CGFloat(panes.count - 1)
            paneWidths[flexible] = 0
            paneWidths[flexible] = splitView.bounds.width - gutters - paneWidths.reduce(0, +)
            for index in panes.indices.reversed() where index != flexible {
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
