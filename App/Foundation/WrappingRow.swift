import SwiftUI

/// A row that wraps: its subviews laid out leading to trailing at their own
/// sizes, `spacing` apart, starting a new line when the next would not fit
/// the width proposed. The chip row is the first use.
struct WrappingRow: Layout {
    let spacing: CGFloat

    /// Where each subview goes, relative to the row's origin, and the
    /// height the lines take together.
    private struct Placement {
        var origins: [CGPoint] = []
        var height: CGFloat = 0
    }

    func sizeThatFits(
        proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) -> CGSize {
        let width = proposal.width ?? .infinity
        let placement = place(subviews, within: width)
        let widest = zip(placement.origins, subviews).map {
            $0.x + $1.sizeThatFits(.unspecified).width
        }
        return CGSize(width: widest.max() ?? 0, height: placement.height)
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        let placement = place(subviews, within: bounds.width)
        for (subview, origin) in zip(subviews, placement.origins) {
            subview.place(
                at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
                anchor: .topLeading, proposal: .unspecified)
        }
    }

    /// A subview that does not fit beside the one before it starts the next
    /// line; a line is as tall as its tallest subview. An infinite width is
    /// one line.
    private func place(_ subviews: Subviews, within width: CGFloat) -> Placement {
        var placement = Placement()
        var cursor = CGPoint.zero
        var lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursor.x > 0, cursor.x + size.width > width {
                cursor = CGPoint(x: 0, y: cursor.y + lineHeight + spacing)
                lineHeight = 0
            }
            placement.origins.append(cursor)
            cursor.x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        placement.height = subviews.isEmpty ? 0 : cursor.y + lineHeight
        return placement
    }
}
