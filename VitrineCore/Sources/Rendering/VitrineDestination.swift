import Foundation

/// The `vitrine:` destination the pre-pass writes for a token cmark has no
/// syntax for, and the walk reads back into a wikilink, an image, or a tag
/// (ADR 0019). It never leaves the seam.
enum VitrineDestination: Equatable {
    case note(target: String)
    case attachment(path: String, width: Int?)
    case tag(name: String)

    private static let scheme = "vitrine:"

    /// The destination as a link target cmark passes through untouched:
    /// every value percent-encoded, so a space or a `)` in a title cannot
    /// end the link early.
    var url: String {
        switch self {
        case .note(let target):
            return "\(Self.scheme)note?target=\(Self.encode(target))"
        case .attachment(let path, let width):
            let width = width.map { "&width=\($0)" } ?? ""
            return "\(Self.scheme)attachment?path=\(Self.encode(path))\(width)"
        case .tag(let name):
            return "\(Self.scheme)tag?name=\(Self.encode(name))"
        }
    }

    /// The destination `url` spells, or nil for any other destination — a
    /// URL or a path the note wrote itself.
    init?(_ url: String) {
        guard url.hasPrefix(Self.scheme) else { return nil }
        let parts = url.dropFirst(Self.scheme.count).split(separator: "?", maxSplits: 1)
        let query = parts.count > 1 ? parts[1] : ""
        var values: [Substring: String] = [:]
        for pair in query.split(separator: "&") {
            let keyAndValue = pair.split(separator: "=", maxSplits: 1)
            guard keyAndValue.count == 2 else { continue }
            values[keyAndValue[0]] = String(keyAndValue[1]).removingPercentEncoding
        }
        switch parts.first {
        case "note":
            guard let target = values["target"] else { return nil }
            self = .note(target: target)
        case "attachment":
            guard let path = values["path"] else { return nil }
            self = .attachment(path: path, width: values["width"].flatMap { Int($0) })
        case "tag":
            guard let name = values["name"] else { return nil }
            self = .tag(name: name)
        default:
            return nil
        }
    }

    /// RFC 3986's unreserved characters stay; everything else — spaces,
    /// parentheses, `&`, `=`, non-ASCII — is encoded.
    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func encode(_ value: String) -> String {
        // Every character has an encoding; nil is impossible here, and an
        // unencodable value would render as nothing rather than crash.
        value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }
}
