import Foundation

/// The one folding search matches under (ADR 0018): case and diacritics
/// ignored, so `cafe` finds `Café` and `sae` finds `SAE`. Query terms and
/// note texts are folded alike, and a match in folded text is mapped back
/// onto the original characters it came from.
enum TextFolding {
    static let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    /// `text` folded, as UTF-8 bytes — what the scan runs over. Line
    /// breaks survive folding, so a folded text has its original's lines.
    static func fold(_ text: String) -> [UInt8] {
        Array(text.folding(options: options, locale: nil).utf8)
    }

    /// The UTF-8 ranges in `text` of every occurrence of every folded term,
    /// in order of position, each once — what the highlight wash covers.
    /// A character that folds to more than one — `ß` to `ss` — can be hit
    /// by a term more than once and is ranged whole, once.
    static func ranges(of terms: [[UInt8]], in text: String) -> [Range<Int>] {
        let folded = FoldedCharacters(text)
        var ranges: [Range<Int>] = []
        for range in terms.flatMap(folded.ranges).sorted(by: { $0.lowerBound < $1.lowerBound })
        where ranges.last != range {
            ranges.append(range)
        }
        return ranges
    }
}
