import Foundation

/// A text folded one character at a time, each folded byte remembering
/// the character it came from. Folding can change a character's length —
/// `é` is two bytes, `e` one — and this is what maps a match in the folded
/// text back onto whole original characters, exactly. Character by
/// character is the slow way to fold, so a note's text is folded whole
/// for the scan (`TextFolding.fold`) and only the one line an excerpt
/// shows, or a title, comes through here.
struct FoldedCharacters {
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
        folded.occurrences(of: term).map { range in
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
