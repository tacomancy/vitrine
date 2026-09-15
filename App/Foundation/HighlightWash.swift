import SwiftUI

/// The brief's brass highlight wash (rule 3: brass as punctuation): the
/// `accent-quiet` token behind the matched characters of a line, the text
/// itself left in whatever color the caller sets. The one way matched
/// terms are marked — in a result's title and the preview rail's excerpt.
enum HighlightWash {
    /// `text` with each of `ranges` — UTF-8 offset ranges into it, as the
    /// `Search` seam hands them out — washed.
    static func washed(_ text: String, ranges: [Range<Int>]) -> AttributedString {
        var attributed = AttributedString(text)
        let utf8 = text.utf8
        for range in ranges {
            let lower = utf8.index(utf8.startIndex, offsetBy: range.lowerBound)
            let upper = utf8.index(utf8.startIndex, offsetBy: range.upperBound)
            guard let start = AttributedString.Index(lower, within: attributed),
                let end = AttributedString.Index(upper, within: attributed)
            else { continue }
            attributed[start..<end].backgroundColor = Color(.accentQuiet)
        }
        return attributed
    }
}
