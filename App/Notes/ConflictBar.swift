import SwiftUI

/// The bar over the note's text while its file has changed or gone under
/// a buffer that holds text worth keeping (ADR 0014): what happened, as a
/// status with its icon and label (brief rule 5), and the two ways to
/// answer it, each a sapphire action (rule 2). The buffer holds every
/// save until one is taken.
struct ConflictBar: View {
    let conflict: NoteBuffer.Conflict
    let buffer: NoteBuffer
    let selection: NotesSelection

    private static let padding = EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 8)
    private static let spacing: CGFloat = 8
    private static let iconSize: CGFloat = 11

    var body: some View {
        HStack(spacing: Self.spacing) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: Self.iconSize, weight: .medium))
            Text(label)
                .font(.sans(.caption, weight: .medium))
            Spacer(minLength: Self.spacing)
            switch conflict {
            case .changedOnDisk:
                PrimaryButton(title: "Overwrite", action: buffer.overwrite)
                PrimaryButton(title: "Reload", action: buffer.reload)
            case .removedFromDisk:
                PrimaryButton(title: "Save as new", action: buffer.saveAsNew)
                // The selection closes the note; the buffer empties as it follows.
                PrimaryButton(title: "Close", action: selection.close)
            }
        }
        .foregroundStyle(Color(.warning))
        .padding(Self.padding)
        .background(Color(.warningBg), in: RoundedRectangle(cornerRadius: Radius.medium))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private var label: String {
        switch conflict {
        case .changedOnDisk: "Changed on disk"
        case .removedFromDisk: "Removed from disk"
        }
    }
}
