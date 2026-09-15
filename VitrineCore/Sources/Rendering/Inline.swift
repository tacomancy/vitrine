/// One run of inline content within a block (ADR 0019).
public indirect enum Inline: Sendable, Equatable {
    /// Literal text, exactly as written: no smart punctuation (ADR 0019).
    case text(String)
    /// `*emphasised*` content.
    case emphasis([Inline])
    /// `**strong**` content.
    case strong([Inline])
    /// An inline code span's text, backticks excluded.
    case code(String)
    /// `~~struck~~` content.
    case strikethrough([Inline])
    /// A Markdown link: its destination — a URL as written, or a path
    /// relative to the note, percent-decoded as the parser decodes it —
    /// and its text. What a path resolves to is the app's business.
    case link(destination: String, inlines: [Inline])
    /// A wikilink: the title it points at, fragment dropped, and its shown
    /// text — the display text after `|`, or the target itself.
    case wikilink(target: String, inlines: [Inline])
    /// A `#tag`, named without its `#`.
    case tag(String)
    /// A line ending within a paragraph.
    case softBreak
    /// A hard line break: two trailing spaces or a backslash.
    case lineBreak
}
