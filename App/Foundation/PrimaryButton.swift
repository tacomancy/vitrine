import SwiftUI

/// The brief's action button (rule 2: sapphire is every action): `primary`
/// filled, `on-primary` text at `caption`, `Radius.medium`, lifting to
/// `primary-hover` under the pointer, and the brass ring when focused
/// (rule 7). The first filled button in the app; every bar action uses it.
struct PrimaryButton: View {
    let title: String
    let action: () -> Void

    @State private var isHovered = false
    @FocusState private var isFocused: Bool

    private static let padding = EdgeInsets(top: 3, leading: 9, bottom: 3, trailing: 9)

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.sans(.caption, weight: .medium))
                .foregroundStyle(Color(.onPrimary))
                .padding(Self.padding)
                .background(
                    Color(isHovered ? .primaryHover : .primary),
                    in: RoundedRectangle(cornerRadius: Radius.medium))
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
        .onHover { isHovered = $0 }
    }
}
