import SwiftUI

/// The open note's text exactly as it is on disk, with every link and embed
/// clickable and styled for what it points at — the whole `[[…]]` or
/// `[…](…)` token, nothing hidden or substituted (CONTEXT.md § Editor).
/// Attributed `Text` over a URL scheme the view intercepts: disposable by
/// decision (spec #25), replaced wholesale when the editor lands
/// (ADR 0013); no `NSTextView`.
struct NoteBody: View {
    let text: String
    /// `BodyLink.all` for `text`, in document order.
    let links: [BodyLink]
    let follow: (BodyLink.Destination) -> Void

    /// A clickable token's URL is this scheme and its index in `links`, so
    /// the click routes back here and nowhere near the system.
    private static let scheme = "vitrine-link"

    var body: some View {
        Text(attributedText)
            // Sapphire is every link (brief, rule 2); `Text` colors a link
            // from the tint, not from the run.
            .tint(Color(.link))
            .environment(
                \.openURL,
                OpenURLAction { url in
                    guard url.scheme == Self.scheme, let index = url.host().flatMap(Int.init),
                        links.indices.contains(index)
                    else { return .systemAction }
                    follow(links[index].destination)
                    return .handled
                })
    }

    /// The text with each link's token attributed in place, by UTF-8
    /// offsets; a token the text does not contain is skipped.
    private var attributedText: AttributedString {
        let utf8 = Array(text.utf8)
        var attributed = AttributedString()
        var cursor = 0
        for (index, link) in links.enumerated() {
            guard link.range.lowerBound >= cursor, link.range.upperBound <= utf8.count else {
                continue
            }
            attributed += AttributedString(
                String(decoding: utf8[cursor..<link.range.lowerBound], as: UTF8.self))
            attributed += token(
                String(decoding: utf8[link.range], as: UTF8.self), for: link, at: index)
            cursor = link.range.upperBound
        }
        attributed += AttributedString(String(decoding: utf8[cursor...], as: UTF8.self))
        return attributed
    }

    /// A link to somewhere is the `link` token and clickable; an unresolved
    /// one is `fg-muted` with a dashed underline and not a link at all, so
    /// clicking it does nothing (docs/visual-implementation.md, The editor).
    private func token(_ text: String, for link: BodyLink, at index: Int) -> AttributedString {
        var token = AttributedString(text)
        switch link.destination {
        case .note, .attachment, .external:
            token.link = URL(string: "\(Self.scheme)://\(index)")
        case .unresolved:
            token.foregroundColor = Color(.fgMuted)
            token.underlineStyle = Text.LineStyle(pattern: .dash)
        }
        return token
    }
}
