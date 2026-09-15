import SwiftUI

/// Fixed dimensions of the tag page at compact density (screen 09's page
/// header and CO-OCCURS WITH rail, drawn on one surface).
enum TagPageMetrics {
    static let padding = EdgeInsets(top: 16, leading: 22, bottom: 16, trailing: 22)
    /// Between the heading, the stat line, and the chips.
    static let headerSpacing: CGFloat = 9
    /// Between the stat line's count and its link.
    static let statSpacing: CGFloat = 12
    static let chipSpacing: CGFloat = 5
    /// Above the CO-OCCURS WITH label.
    static let sectionSpacing: CGFloat = 20
    /// Between the label and the first row.
    static let labelGap: CGFloat = 12
    /// Between co-occurrence rows.
    static let rowSpacing: CGFloat = 12
    /// Between a row's name line and its bar.
    static let barSpacing: CGFloat = 4
    static let barHeight: CGFloat = 4
    /// The widest a bar runs: the rail's width on screen 09, so a bar
    /// stays a bar on a wide page.
    static let measure: CGFloat = 480
    /// How many co-occurring tags the page shows before *and N more*.
    static let rowLimit = 10
    /// Under this many notes, co-occurrence is noise — `1/1 · 100 %` — and
    /// the section says so instead.
    static let minimumNotesForCoOccurrence = 3
}
