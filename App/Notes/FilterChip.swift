import SwiftUI

/// One filter chip (CONTEXT.md § Note list) in the brief's info style:
/// `info-bg` filled, `info-line` bordered, `#tag` in mono `label` and its
/// `×` in `info`, at `Radius.medium`. The `×` is the one control; it takes
/// the brass ring when focused (rule 7).
struct FilterChip: View {
    /// The tag in display spelling, without its `#`.
    let tag: String
    let remove: () -> Void

    @FocusState private var isFocused: Bool

    private static let borderWidth: CGFloat = 1

    var body: some View {
        HStack(spacing: NoteListMetrics.chipRemoveSpacing) {
            Text("#" + tag)
                .font(.mono(.label, weight: .regular))
                .lineLimit(1)
            Button(action: remove) {
                Text("×")
                    .font(.sans(.caption, weight: .medium))
            }
            .buttonStyle(.plain)
            .focused($isFocused)
            .accessibilityLabel("Remove #\(tag)")
        }
        .foregroundStyle(Color(.info))
        .padding(.horizontal, NoteListMetrics.chipPaddingHorizontal)
        .frame(height: NoteListMetrics.chipHeight)
        .background(Color(.infoBg), in: RoundedRectangle(cornerRadius: Radius.medium))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.medium)
                .strokeBorder(Color(.infoLine), lineWidth: Self.borderWidth)
        }
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
    }
}
