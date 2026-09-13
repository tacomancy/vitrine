import SwiftUI

/// Centers the system traffic lights in the drawn 38 px title bar. A
/// hidden-title-bar window places them for the system's own, shorter bar
/// (ADR 0008).
struct TrafficLightsAlignment: NSViewRepresentable {
    func makeNSView(context: Context) -> TrafficLightsAlignmentView {
        TrafficLightsAlignmentView()
    }

    func updateNSView(_ view: TrafficLightsAlignmentView, context: Context) {}
}
