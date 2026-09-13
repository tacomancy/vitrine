import SwiftUI

/// The SCOUTS block at the bottom of the sidebar, marked SOON. A stub: the
/// label and badge and nothing else (ADR 0005).
struct ScoutsStub: View {
    private static let badgeSpacing: CGFloat = 7
    private static let bottomInset: CGFloat = 9

    var body: some View {
        HStack(spacing: Self.badgeSpacing) {
            CapsLabel(text: "Scouts", color: Color(.fgMuted))
            SoonBadge()
        }
        .padding(.bottom, Self.bottomInset)
    }
}
