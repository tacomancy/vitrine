/// Where an image comes from.
public enum ImageSource: Sendable, Equatable {
    /// A file in the library, by the name or relative path written in the
    /// embed; the app resolves it as the Index resolves an embed.
    case attachment(String)
    /// A URL, as written.
    case external(String)
}
