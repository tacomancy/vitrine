import SwiftUI

/// One row of the command palette: the mono kind tag, the label with the
/// query's terms washed, and the meta right-aligned in mono. Highlighted,
/// it is the selected-row pill (ADR 0008, Update) with its tag in `link`
/// and its label in `fg`. Clicking it opens it; the pointer over it
/// highlights it.
struct PaletteResultRow: View {
    let row: PaletteRow
    let isHighlighted: Bool
    let highlight: () -> Void
    let open: () -> Void

    var body: some View {
        RowButton(isSelected: isHighlighted, select: open) {
            HStack(spacing: PaletteMetrics.rowSpacing) {
                Text(row.kindTag)
                    .font(.mono(.label, weight: .regular))
                    .foregroundStyle(isHighlighted ? Color(.link) : Color(.fgMuted))
                Text(HighlightWash.washed(row.label, ranges: row.labelRanges))
                    .font(.sans(.compact, weight: .regular))
                    .foregroundStyle(isHighlighted ? Color(.fg) : Color(.fgSecondary))
                    .lineLimit(1)
                Spacer(minLength: PaletteMetrics.rowSpacing)
                if let meta = row.meta {
                    Text(meta)
                        .font(.mono(.label, weight: .regular))
                        .foregroundStyle(Color(.fgMuted))
                }
            }
            .padding(.vertical, PaletteMetrics.rowPaddingVertical)
            .padding(.horizontal, PaletteMetrics.rowPaddingHorizontal)
        }
        .onHover { isHovering in
            if isHovering { highlight() }
        }
        .accessibilityValue(row.meta ?? "")
    }
}
