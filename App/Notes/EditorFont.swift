import AppKit

/// The editor's faces (ADR 0013): Inter for the note's text, semibold at a
/// heading size for a heading line, and IBM Plex Mono for code and
/// frontmatter — each by its registered PostScript name, made once.
enum EditorFont {
    static let body = NSFont.bundled(BundledFonts.PostScriptName.sansRegular, .body)
    /// Code and frontmatter, one step under the body so a mono run sits in
    /// a line of Inter (docs/visual-implementation.md, The editor).
    static let mono = NSFont.bundled(BundledFonts.PostScriptName.monoRegular, .compact)

    /// A heading's size steps down the scale from the note title's, levels
    /// five and six at the body's; every level is semibold.
    static func heading(level: Int) -> NSFont {
        let step: TypeScale =
            switch level {
            case 1: .title
            case 2: .heading
            case 3: .subheading
            case 4: .lead
            default: .body
            }
        return .bundled(BundledFonts.PostScriptName.sansSemiBold, step)
    }

    /// The mockup's 1.65 line height at the body size, less Inter's own line.
    static let paragraphStyle: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 6
        return style
    }()
}
