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
    /// in order of position — what the highlight wash covers.
    static func ranges(of terms: [[UInt8]], in text: String) -> [Range<Int>] {
        let folded = FoldedCharacters(text)
        return terms.flatMap(folded.ranges).sorted { $0.lowerBound < $1.lowerBound }
    }
}

/// A text folded one character at a time, each folded byte remembering
/// the character it came from. Folding can change a character's length —
/// `é` is two bytes, `e` one — and this is what maps a match in the folded
/// text back onto whole original characters, exactly.
private struct FoldedCharacters {
    private let folded: [UInt8]
    /// For every folded byte, the original UTF-8 offset of its character;
    /// one more entry for the end, so a range's upper bound maps too.
    private let origins: [Int]

    init(_ text: String) {
        var folded: [UInt8] = []
        var origins: [Int] = []
        var offset = 0
        for character in text {
            let foldedCharacter =
                String(character).folding(options: TextFolding.options, locale: nil).utf8
            folded.append(contentsOf: foldedCharacter)
            origins.append(contentsOf: repeatElement(offset, count: foldedCharacter.count))
            offset += character.utf8.count
        }
        origins.append(offset)
        self.folded = folded
        self.origins = origins
    }

    /// The original ranges of every occurrence of `term`, in order.
    func ranges(of term: [UInt8]) -> [Range<Int>] {
        folded.ranges(of: term).map { range in
            origins[range.lowerBound]..<endOfCharacter(at: range.upperBound - 1)
        }
    }

    /// The original offset just past the character that produced folded
    /// byte `index`: where the next character begins.
    private func endOfCharacter(at index: Int) -> Int {
        var next = index + 1
        while origins[next] == origins[index] { next += 1 }
        return origins[next]
    }
}
