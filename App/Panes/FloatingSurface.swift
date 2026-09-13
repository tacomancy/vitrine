import SwiftUI

/// A pane drawn as a floating `bg-surface` card at the large radius, on the
/// `bg` ground — no hairline around it (ADR 0008, Update).
struct FloatingSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.bgSurface), in: RoundedRectangle(cornerRadius: Radius.large))
    }
}

extension View {
    func floatingSurface() -> some View {
        modifier(FloatingSurface())
    }
}
