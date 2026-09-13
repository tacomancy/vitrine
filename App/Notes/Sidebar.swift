import SwiftUI

/// The sidebar, directly on `bg`: LIBRARY and FILES above, the SCOUTS stub
/// pinned at the bottom (ADR 0005). Empty until a library is open.
struct Sidebar: View {
    private static let sectionSpacing: CGFloat = 11
    private static let labelInset: CGFloat = 12
    private static let topInset: CGFloat = 5

    var body: some View {
        VStack(alignment: .leading, spacing: Self.sectionSpacing) {
            CapsLabel(text: "Library", color: Color(.fgMuted))
            CapsLabel(text: "Files", color: Color(.fgMuted))
            Spacer()
            ScoutsStub()
        }
        .padding(.horizontal, Self.labelInset)
        .padding(.top, Self.topInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
