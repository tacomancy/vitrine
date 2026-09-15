import SwiftUI

/// A note's tags as one line — `#tag #other` in mono `label`, `link`,
/// ellipsised — as the note list, the editor's rail, and the command
/// palette's preview rail all draw it. Text, not a control: nothing in it
/// navigates.
struct TagRow: View {
    /// The note's tags in display spelling, in `Index.tags(of:)` order.
    let tags: [String]

    var body: some View {
        Text(tags.map { "#" + $0 }.joined(separator: " "))
            .font(.mono(.label, weight: .regular))
            .foregroundStyle(Color(.link))
            .lineLimit(1)
    }
}
