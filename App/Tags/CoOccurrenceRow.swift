import Index
import SwiftUI

/// One CO-OCCURS WITH row (CONTEXT.md § Tag page): the other tag in mono,
/// `count/outOf · P %` in mono at the trailing end, and under them a bar
/// whose width is that share, in the sequential ramp's color for the row's
/// slot — the first chart in Vitrine, so the brief's chart rules apply.
struct CoOccurrenceRow: View {
    let entry: TagCoOccurrence
    /// The row's place in the list, counted from 1 at the top.
    let slot: Int

    var body: some View {
        VStack(alignment: .leading, spacing: TagPageMetrics.barSpacing) {
            HStack(alignment: .firstTextBaseline) {
                Text("#" + entry.tag)
                    .font(.mono(.caption, weight: .regular))
                    .foregroundStyle(Color(.fgSecondary))
                    .lineLimit(1)
                Spacer(minLength: TagPageMetrics.statSpacing)
                Text("\(entry.count)/\(entry.outOf) · \(percent) %")
                    .font(.mono(.label, weight: .regular))
                    .foregroundStyle(Color(.fgMuted))
            }
            bar
        }
        .accessibilityElement(children: .combine)
    }

    private var bar: some View {
        GeometryReader { geometry in
            RoundedRectangle(cornerRadius: Radius.small)
                .fill(Color(.line))
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: Radius.small)
                        .fill(SequentialRamp.color(atSlot: slot))
                        .frame(width: geometry.size.width * share)
                }
        }
        .frame(height: TagPageMetrics.barHeight)
        .accessibilityHidden(true)
    }

    private var share: CGFloat {
        CGFloat(entry.count) / CGFloat(entry.outOf)
    }

    private var percent: Int {
        Int((Double(entry.count) * 100 / Double(entry.outOf)).rounded())
    }
}
