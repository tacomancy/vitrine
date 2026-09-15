import SwiftUI

/// A note's tags on one line — `#tag #other` in mono `label` and `link`,
/// ellipsised — each a click that adds it as a filter chip (CONTEXT.md
/// § Note list). Attributed `Text` over a URL scheme the view intercepts,
/// as the read-only body once was (spec #25): one `Text` keeps the line
/// one line. A note with no tags is an empty line the same height.
struct TagRow: View {
    /// The tags in display spelling, in `Index.tags(of:)` order.
    let tags: [String]
    let addChip: (String) -> Void

    /// A tag's URL is this scheme and its index in `tags`, so the click
    /// routes back here and nowhere near the system.
    private static let scheme = "vitrine-tag"

    var body: some View {
        Text(attributedTags)
            .font(.mono(.label, weight: .regular))
            // `Text` colors a link from the tint, not from the run.
            .tint(Color(.link))
            .lineLimit(1)
            .environment(
                \.openURL,
                OpenURLAction { url in
                    guard url.scheme == Self.scheme, let index = url.host().flatMap(Int.init),
                        tags.indices.contains(index)
                    else { return .systemAction }
                    addChip(tags[index])
                    return .handled
                })
    }

    private var attributedTags: AttributedString {
        var attributed = AttributedString()
        for (index, tag) in tags.enumerated() {
            if index > 0 { attributed += AttributedString(" ") }
            var token = AttributedString("#" + tag)
            token.link = URL(string: "\(Self.scheme)://\(index)")
            attributed += token
        }
        return attributed
    }
}
