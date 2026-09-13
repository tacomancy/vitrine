import AppKit

/// Moves the window's standard buttons to the vertical center of the drawn
/// title bar, and again after every resize and on leaving full screen — the
/// window lays them out afresh on both.
final class TrafficLightsAlignmentView: NSView {
    private var observers: [NSObjectProtocol] = []

    // Observers are removed here when the view leaves its window; the view
    // lives as long as the title bar does, so there is no separate teardown.
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        guard let window else { return }
        align(window)
        for name in [NSWindow.didResizeNotification, NSWindow.didExitFullScreenNotification] {
            observers.append(
                NotificationCenter.default.addObserver(
                    forName: name, object: window, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated { self?.align(window) }
                })
        }
    }

    private func align(_ window: NSWindow) {
        let buttons: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
        for type in buttons {
            guard let button = window.standardWindowButton(type), let bar = button.superview else {
                continue
            }
            let centerFromTop = ShellMetrics.titleBarHeight / 2
            var frame = button.frame
            frame.origin.y =
                bar.isFlipped
                ? centerFromTop - frame.height / 2
                : bar.bounds.height - centerFromTop - frame.height / 2
            button.frame = frame
        }
    }
}
