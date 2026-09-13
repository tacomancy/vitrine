import SwiftUI

extension Font {
    /// Inter at a step of the scale — all product UI (ADR 0009).
    static func sans(_ step: TypeScale, weight: Weight) -> Font {
        .custom(BundledFonts.sansFamily, size: step.rawValue).weight(weight)
    }

    /// IBM Plex Mono at a step of the scale — counts, labels, timestamps.
    static func mono(_ step: TypeScale, weight: Weight) -> Font {
        .custom(BundledFonts.monoFamily, size: step.rawValue).weight(weight)
    }
}
