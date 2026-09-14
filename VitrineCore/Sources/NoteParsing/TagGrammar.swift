/// The rule for what spells a tag (CONTEXT.md § Tags), in one place so the
/// body scanner and the frontmatter reader cannot drift apart.
enum TagGrammar {
    /// Whether `name`, without its `#`, is a tag: every scalar is a tag
    /// character and at least one is not a digit. Obsidian requires the
    /// non-digit, so `1` is not a tag; nor is the empty string.
    static func isTag(_ name: String) -> Bool {
        name.unicodeScalars.allSatisfy(isTagCharacter)
            && name.unicodeScalars.contains { !isDigit($0) }
    }

    static func isTagCharacter(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.isAlphabetic || isDigit(scalar)
            || scalar == "_" || scalar == "-" || scalar == "/"
    }

    /// A decimal digit in any script (Unicode `Nd`); a letter that also names
    /// a number, like `三`, is a letter.
    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.generalCategory == .decimalNumber
    }
}
