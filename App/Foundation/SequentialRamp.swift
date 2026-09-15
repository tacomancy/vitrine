import SwiftUI

/// The brief's sequential ramp (§ Chart colour): one hue, sapphire, in six
/// steps — `seq-1`, the darkest on dark, to `seq-6`, the lightest. Slots are
/// fixed and never cycled (rule 6): a row past the sixth takes the lightest
/// step and stays there, so a list only ever gets lighter down its length.
enum SequentialRamp {
    static let steps = [
        Color(.seq1), Color(.seq2), Color(.seq3), Color(.seq4), Color(.seq5), Color(.seq6),
    ]

    /// The color of the row at `slot`, counted from 1 at the top.
    static func color(atSlot slot: Int) -> Color {
        steps[min(max(slot, 1), steps.count) - 1]
    }
}
