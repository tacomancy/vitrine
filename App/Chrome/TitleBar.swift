import SwiftUI

/// The drawn 38 px title bar: the system traffic lights stay in place on the
/// left; the mark, the app name, and the library name follow (ADR 0008).
struct TitleBar: View {
    private static let itemSpacing: CGFloat = 8

    var body: some View {
        HStack(spacing: Self.itemSpacing) {
            TrafficLightsAlignment().frame(width: ShellMetrics.trafficLightsWidth)
            Image(.mark)
                .resizable()
                .frame(width: ShellMetrics.markSize, height: ShellMetrics.markSize)
                .accessibilityHidden(true)
            Text("Vitrine")
                .font(.sans(.compact, weight: .semibold))
                .foregroundStyle(Color(.fgSecondary))
            // TODO(#12): the open library's name replaces this placeholder.
            Text("— No library")
                .font(.sans(.caption, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
            Spacer()
        }
        .frame(height: ShellMetrics.titleBarHeight)
        .background(Color(.bgRaised))
        .contentShape(Rectangle())
        .gesture(WindowDragGesture())
    }
}
