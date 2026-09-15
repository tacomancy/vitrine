import Foundation

extension [UInt8] {
    /// The first occurrence of `needle` at or after `start`. Through libc's
    /// `memmem`: the standard library's generic search read the real vault
    /// at about five megabytes a second, a hundred milliseconds for a query
    /// matching nothing — past the palette's debounce, which ADR 0018 names
    /// as its trigger — where `memmem` takes under a millisecond.
    func firstOccurrence(of needle: [UInt8], from start: Int = 0) -> Range<Int>? {
        guard !needle.isEmpty, start + needle.count <= count else { return nil }
        return withUnsafeBytes { haystack in
            needle.withUnsafeBytes { needle in
                guard let haystackStart = haystack.baseAddress,
                    let needleStart = needle.baseAddress,
                    let found = memmem(
                        haystackStart + start, haystack.count - start, needleStart, needle.count)
                else { return nil }
                let offset = UnsafeRawPointer(found) - haystackStart
                return offset..<(offset + needle.count)
            }
        }
    }

    /// Every occurrence of `needle`, in order, none overlapping another.
    func occurrences(of needle: [UInt8]) -> [Range<Int>] {
        var occurrences: [Range<Int>] = []
        var start = 0
        while let occurrence = firstOccurrence(of: needle, from: start) {
            occurrences.append(occurrence)
            start = occurrence.upperBound
        }
        return occurrences
    }
}
