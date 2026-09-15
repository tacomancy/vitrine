import SwiftUI

/// The title bar's search field (design/README.md § Window shell): a 24 px
/// control with the search glyph, the *Search* placeholder, and the `⌘K`
/// hint, on `line` with a 1 px `line-strong` edge at `Radius.medium`. It
/// is not a field to type in: activating it opens the command palette,
/// which holds the query. Focusable, with the brass ring (rule 7).
struct SearchField: View {
    let open: () -> Void

    @FocusState private var isFocused: Bool

    private static let height: CGFloat = 24
    private static let minimumWidth: CGFloat = 180
    private static let paddingHorizontal: CGFloat = 9
    private static let spacing: CGFloat = 7
    private static let glyphSize: CGFloat = 11
    private static let edgeWidth: CGFloat = 1

    var body: some View {
        Button(action: open) {
            HStack(spacing: Self.spacing) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: Self.glyphSize))
                    .foregroundStyle(Color(.fgMuted))
                    .accessibilityHidden(true)
                Text("Search")
                    .font(.sans(.caption, weight: .regular))
                    .foregroundStyle(Color(.fgMuted))
                Spacer(minLength: Self.spacing)
                Text("⌘K")
                    .font(.mono(.label, weight: .regular))
                    .foregroundStyle(Color(.fgMuted))
            }
            .padding(.horizontal, Self.paddingHorizontal)
            .frame(minWidth: Self.minimumWidth, maxWidth: Self.minimumWidth)
            .frame(height: Self.height)
            .background(Color(.line), in: RoundedRectangle(cornerRadius: Radius.medium))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.medium)
                    .stroke(Color(.lineStrong), lineWidth: Self.edgeWidth)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
        .accessibilityLabel("Search")
        .accessibilityHint("Opens the command palette")
    }
}
