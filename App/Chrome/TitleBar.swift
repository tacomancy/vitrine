import SwiftUI

/// The drawn 38 px title bar: the system traffic lights stay in place on the
/// left; the mark, the app name, and the library name follow (ADR 0008).
struct TitleBar: View {
    /// The open library's name; `nil` on First run.
    let libraryName: String?

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
            if let libraryName {
                Text("— \(libraryName)")
                    .font(.sans(.caption, weight: .regular))
                    .foregroundStyle(Color(.fgMuted))
            }
            Spacer()
        }
        .frame(height: ShellMetrics.titleBarHeight)
        .background(Color(.bgRaised))
        .contentShape(Rectangle())
        .gesture(WindowDragGesture())
    }
}
