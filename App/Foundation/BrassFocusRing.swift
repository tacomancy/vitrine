import SwiftUI

/// The brief's focus treatment (rule 7): a 2 px brass ring, 2 px outside the
/// control, in place of the system's accent-colored ring.
struct BrassFocusRing: ViewModifier {
    let isFocused: Bool
    let cornerRadius: CGFloat

    private static let width: CGFloat = 2
    private static let offset: CGFloat = 2

    func body(content: Content) -> some View {
        content
            .focusEffectDisabled()
            .overlay {
                if isFocused {
                    RoundedRectangle(cornerRadius: cornerRadius + Self.offset)
                        .stroke(Color(.focus), lineWidth: Self.width)
                        .padding(-(Self.offset + Self.width / 2))
                }
            }
    }
}

extension View {
    func brassFocusRing(isFocused: Bool, cornerRadius: CGFloat) -> some View {
        modifier(BrassFocusRing(isFocused: isFocused, cornerRadius: cornerRadius))
    }
}
