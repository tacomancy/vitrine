import SwiftUI

/// *Open in Notes*, the tag page's one action, as a text link: caps `label`
/// in `link` (rule 2), the pointer a hand, the brass ring when focused.
struct OpenInNotesLink: View {
    let action: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: action) {
            CapsLabel(text: "Open in Notes", color: Color(.link))
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .brassFocusRing(isFocused: isFocused, cornerRadius: Radius.small)
        .pointerStyle(.link)
        .accessibilityLabel("Open in Notes")
    }
}
