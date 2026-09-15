import Markdown
import NoteParsing

/// The Rendering seam (ADR 0019): a note's text as the blocks Preview draws.
public enum RenderedNote {
    /// Renders the note `parsed` was read from into blocks: frontmatter cut,
    /// wikilinks, embeds, and tags rendered as what they are, CommonMark with
    /// tables, task lists, and strikethrough for the rest. Pure, and never
    /// fails: text that is not Markdown in any recognisable way is
    /// paragraphs.
    public static func render(_ parsed: ParsedNote) -> [Block] {
        let prePass = PrePass(parsed)
        // ADR 0019: smart punctuation off, so `"quotes"` and `--` stay as typed.
        let document = Document(parsing: prePass.text, options: [.disableSmartOpts])
        return BlockConverter(prePass: prePass).blocks(of: document)
    }
}
