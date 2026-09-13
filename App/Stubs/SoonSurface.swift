import SwiftUI

/// What a stub tab shows: one floating surface carrying the tab's name and
/// the SOON badge, and nothing else (ADR 0005).
struct SoonSurface: View {
    let tab: Tab

    private static let spacing: CGFloat = 8

    var body: some View {
        HStack(spacing: Self.spacing) {
            Text(tab.title)
                .font(.sans(.body, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
            SoonBadge()
        }
        .floatingSurface()
        .padding(ShellMetrics.gutter)
    }
}
