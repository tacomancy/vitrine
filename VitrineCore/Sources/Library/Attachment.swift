/// Any non-Markdown, non-hidden file in the library (CONTEXT.md). Shown in
/// the file tree by filename; not otherwise interpreted.
public struct Attachment: Sendable, Hashable {
    /// The filename, extension included.
    public let name: String
    /// The file's path relative to the library root.
    public let path: String
}
