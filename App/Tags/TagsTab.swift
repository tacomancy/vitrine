import SwiftUI

/// The Tags tab: one empty floating surface until the tag tree exists.
struct TagsTab: View {
    var body: some View {
        Color.clear
            .floatingSurface()
            .padding(ShellMetrics.gutter)
    }
}
