import Index
import SwiftUI

/// One BACKLINKS entry: the linking note's title, then each context line
/// ellipsised to one line. A button that opens the note; never drawn
/// selected, since the rail lists what links here, not what is open.
struct BacklinkEntry: View {
    let backlink: Backlink
    let open: () -> Void

    var body: some View {
        RowButton(isSelected: false, select: open) {
            VStack(alignment: .leading, spacing: RailMetrics.contextSpacing) {
                Text(backlink.note.title)
                    .font(.sans(.compact, weight: .regular))
                    .foregroundStyle(Color(.fg))
                    .lineLimit(1)
                ForEach(Array(backlink.contexts.enumerated()), id: \.offset) { _, context in
                    Text(context)
                        .font(.sans(.caption, weight: .regular))
                        .foregroundStyle(Color(.fgSecondary))
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, RailMetrics.entryPaddingVertical)
            .padding(.horizontal, RailMetrics.entryPaddingHorizontal)
        }
    }
}
