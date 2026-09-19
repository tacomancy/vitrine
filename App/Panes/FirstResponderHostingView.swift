import AppKit
import SwiftUI

/// An `NSHostingView` that becomes its window's first responder on
/// arrival, so keyboard focus moves into the content it hosts.
final class FirstResponderHostingView<Content: View>: NSHostingView<Content> {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }
}
