import SwiftUI

/// A top-level section of the window. Notes and Tags are functional in v1;
/// Sources, Ideas, and Dashboard are stubs and the only code that may name
/// those reserved concepts (ADR 0005).
enum Tab: CaseIterable {
    case notes
    case sources
    case ideas
    case dashboard
    case tags

    var title: String {
        switch self {
        case .notes: "Notes"
        case .sources: "Sources"
        case .ideas: "Ideas"
        case .dashboard: "Dashboard"
        case .tags: "Tags"
        }
    }

    /// The tab's 6 px marker: square for document-ish tabs, round for
    /// synthesis tabs (design/README.md § Window shell).
    var marker: TabMarker {
        switch self {
        case .notes, .sources, .tags: .square
        case .ideas, .dashboard: .round
        }
    }
}
