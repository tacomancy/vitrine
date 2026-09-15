import Index
import Library
import SwiftUI

/// The command palette's preview rail (CONTEXT.md § Command palette): for
/// the highlighted note, its title, its excerpt with the terms washed, its
/// tags as a mono line, `N links · N backlinks`, and its modification date,
/// the counts and tags from the `Index`. Empty when an action is
/// highlighted, or nothing is.
struct PreviewRail: View {
    let row: PaletteRow?
    let index: Index?

    var body: some View {
        VStack(alignment: .leading, spacing: PaletteMetrics.railSpacing) {
            CapsLabel(text: "Preview", color: Color(.fgMuted))
            if let row, let note = row.note, let index {
                Text(note.title)
                    .font(.sans(.lead, weight: .regular))
                    .foregroundStyle(Color(.fg))
                if case .result(let result) = row, !result.excerpt.text.isEmpty {
                    Text(
                        HighlightWash.washed(result.excerpt.text, ranges: result.excerpt.ranges)
                    )
                    .font(.sans(.compact, weight: .regular))
                    .foregroundStyle(Color(.fgSecondary))
                    .lineSpacing(Self.excerptLineSpacing)
                    .lineLimit(Self.excerptLineLimit)
                }
                let tags = index.tags(of: note)
                if !tags.isEmpty {
                    // The note list's tag row, verbatim: not a control here.
                    Text(tags.map { "#" + $0 }.joined(separator: " "))
                        .font(.mono(.label, weight: .regular))
                        .foregroundStyle(Color(.link))
                        .lineLimit(1)
                }
                Text(
                    "\(index.links(from: note).count) links · \(index.backlinks(to: note).count) backlinks"
                )
                .font(.mono(.label, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
                Text(note.modifiedAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.sans(.caption, weight: .regular))
                    .foregroundStyle(Color(.fgSecondary))
            }
        }
        .padding(PaletteMetrics.railPadding)
        .frame(width: PaletteMetrics.railWidth, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    /// The mockup's 1.6 line height at `compact`, less Inter's own line.
    private static let excerptLineSpacing: CGFloat = 5
    private static let excerptLineLimit = 4
}
