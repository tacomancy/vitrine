import CoreGraphics

/// The brief's letterspacing, as fractions of the em. Applied by multiplying
/// with the point size, since SwiftUI tracks in points.
enum Tracking {
    /// Caps labels: LIBRARY, FILES, SOON.
    static let capsLabel: CGFloat = 0.14
    /// Display lines: the First run headline.
    static let display: CGFloat = -0.022
}
