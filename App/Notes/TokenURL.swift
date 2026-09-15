import Foundation

/// The URL a clickable token carries in its `.link` attribute — in the
/// editor's storage or a `Text`'s attributed string — so the click routes
/// back to the view that set it: a scheme for what kind of token, and its
/// index in the list the view built. A URL because AppKit and `Text`
/// expect one there (AppKit's Copy Link would cast), and schemes nothing
/// on the system opens.
enum TokenURL {
    enum Kind: String {
        /// A link or embed; the index is into the view's `BodyLink`s.
        case link = "vitrine-link"
        /// A tag; the index is into the view's tags.
        case tag = "vitrine-tag"
    }

    static func url(for kind: Kind, index: Int) -> URL? {
        URL(string: "\(kind.rawValue)://\(index)")
    }

    /// The kind and index `url` carries, or nil for any other URL.
    static func parse(_ url: URL) -> (kind: Kind, index: Int)? {
        guard let kind = url.scheme.flatMap(Kind.init(rawValue:)),
            let index = url.host().flatMap(Int.init)
        else { return nil }
        return (kind, index)
    }
}
