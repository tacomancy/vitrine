import SwiftUI

/// A note's tags on one line — `#tag #other` in mono `label` and `link`,
/// ellipsised — each a click that adds it as a filter chip (CONTEXT.md
/// § Note list). Attributed `Text` over a URL scheme the view intercepts,
/// as the read-only body once was (spec #25): one `Text` keeps the line
/// one line. A note with no tags is an empty line the same height.
struct TagRow: View {
    /// The tags in display spelling, in `Index.tags(of:)` order.
    let tags: [String]
    /// What a tag click does; the palette's preview rail leaves it inert.
    var addChip: (String) -> Void = { _ in }

    var body: some View {
        Text(attributedTags)
            .font(.mono(.label, weight: .regular))
            // `Text` colors a link from the tint, not from the run.
            .tint(Color(.link))
            .lineLimit(1)
            .environment(
                \.openURL,
                OpenURLAction { url in
                    guard let token = TokenURL.parse(url), token.kind == .tag,
                        tags.indices.contains(token.index)
                    else { return .systemAction }
                    addChip(tags[token.index])
                    return .handled
                })
    }

    private var attributedTags: AttributedString {
        var attributed = AttributedString()
        for (index, tag) in tags.enumerated() {
            if index > 0 { attributed += AttributedString(" ") }
            var token = AttributedString("#" + tag)
            token.link = TokenURL.url(for: .tag, index: index)
            attributed += token
        }
        return attributed
    }
}
