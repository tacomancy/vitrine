import SwiftUI

/// A section label in the brief's caps style: 11 px mono, 0.14 em tracking,
/// uppercased, in the given token color.
struct CapsLabel: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased())
            .font(.mono(.label, weight: .regular))
            .tracking(TypeScale.label.rawValue * Tracking.capsLabel)
            .foregroundStyle(color)
    }
}
