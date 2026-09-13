import SwiftUI

/// First run's one action, *Open a folder of markdown*: a sapphire-bordered
/// card (rule 2) that takes keyboard focus with the brass ring (rule 7).
struct OpenFolderAction: View {
    let action: () -> Void

    @FocusState private var isFocused: Bool

    private static let itemSpacing: CGFloat = 14
    private static let lineSpacing: CGFloat = 2
    private static let horizontalPadding: CGFloat = 15
    private static let verticalPadding: CGFloat = 13
    private static let borderWidth: CGFloat = 1
    private static let glyphBoxSize: CGFloat = 26
    private static let shape = RoundedRectangle(cornerRadius: Radius.medium)

    var body: some View {
        Button(action: action) {
            HStack(spacing: Self.itemSpacing) {
                Image(systemName: "folder")
                    .font(.system(size: TypeScale.compact.rawValue))
                    .foregroundStyle(Color(.primary))
                    .frame(width: Self.glyphBoxSize, height: Self.glyphBoxSize)
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.small)
                            .stroke(Color(.primary), lineWidth: Self.borderWidth)
                    }
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Self.lineSpacing) {
                    Text("Open a folder of markdown")
                        .font(.sans(.body, weight: .regular))
                        .foregroundStyle(Color(.fg))
                    // The mockup's subline, verbatim (screen 11); "vault" is
                    // Obsidian's word for a library and the one users know.
                    Text("Point at an existing vault, Obsidian folder, or anything with .md in it")
                        .font(.sans(.caption, weight: .regular))
                        .foregroundStyle(Color(.fgMuted))
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: TypeScale.label.rawValue, weight: .medium))
                    .foregroundStyle(Color(.fgMuted))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, Self.horizontalPadding)
            .padding(.vertical, Self.verticalPadding)
            .background(Color(.bgRaised), in: Self.shape)
            .overlay {
                Self.shape.stroke(Color(.primary), lineWidth: Self.borderWidth)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // As the tab strip: `.edit` reaches the action with Tab even with
        // Keyboard navigation off; Space or Return then triggers it.
        .focusable(interactions: [.activate, .edit])
        .focused($isFocused)
        .onKeyPress(.space) {
            action()
            return .handled
        }
        .onKeyPress(.return) {
            action()
            return .handled
        }
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
    }
}
