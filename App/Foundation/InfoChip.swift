import SwiftUI

/// The brief's info chip — a tag as a chip (design/README.md § Color:
/// `info` tokens are "tag chips, filter chips"): `info-bg` filled, a 1 px
/// `info-line` border, the text in mono `label` and `info`, 21 px tall,
/// `Radius.medium`. With `select` it is a button that takes the brass ring
/// when focused; without, it reads only.
struct InfoChip: View {
    let text: String
    let select: (() -> Void)?

    @FocusState private var isFocused: Bool

    static let height: CGFloat = 21
    private static let paddingHorizontal: CGFloat = 8
    private static let borderWidth: CGFloat = 1

    var body: some View {
        if let select {
            Button(action: select) { chip }
                .buttonStyle(.plain)
                .focused($isFocused)
                .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.medium)
                .pointerStyle(.link)
        } else {
            chip
        }
    }

    private var chip: some View {
        Text(text)
            .font(.mono(.label, weight: .regular))
            .foregroundStyle(Color(.info))
            .padding(.horizontal, Self.paddingHorizontal)
            .frame(height: Self.height)
            .background(Color(.infoBg), in: RoundedRectangle(cornerRadius: Radius.medium))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.medium)
                    .stroke(Color(.infoLine), lineWidth: Self.borderWidth))
    }
}
