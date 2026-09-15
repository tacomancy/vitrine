import AppKit
import Index
import Library
import NoteParsing
import SwiftUI

/// The open note's text in an `NSTextView` on TextKit 2 (ADR 0013): its
/// source exactly as the buffer holds it, frontmatter included, with the
/// parser's ranges colored and re-colored on every edit, its links
/// followed and its tags added as filter chips on a click. The view owns
/// nothing but itself — each edit is parsed and reported up as a
/// `ParsedNote`, and the text is written back into the view only when the
/// app's parse is not the one the view showed or reported: a note switch.
struct NoteTextView: NSViewRepresentable {
    let note: Note
    let parsed: ParsedNote
    let index: Index
    let measure: CGFloat
    let inset: NSSize
    let onEdit: (ParsedNote) -> Void
    let follow: (BodyLink.Destination) -> Void
    /// A click on a body tag, given the tag as written without its `#`.
    let addChip: (String) -> Void
    let onFocusChange: (Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            note: note, index: index, onEdit: onEdit, follow: follow, addChip: addChip)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = EditorTextView(usingTextLayoutManager: true)
        // Plain text: the fonts and links in the storage are the parser's,
        // never the user's — no font panel, no pasted attributes.
        textView.isRichText = false
        textView.importsGraphics = false
        textView.usesFontPanel = false
        textView.usesRuler = false
        // ADR 0013: substitutions corrupt Markdown; find, search, and spell
        // checking come from the view.
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticDataDetectionEnabled = false
        textView.isAutomaticTextCompletionEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.isContinuousSpellCheckingEnabled = true
        textView.allowsUndo = true
        // The ring is the brass one, drawn around the scroll view in SwiftUI.
        textView.focusRingType = .none
        textView.drawsBackground = false
        textView.textColor = NSColor(resource: .fg)
        textView.insertionPointColor = NSColor(resource: .fg)
        textView.selectedTextAttributes = [.backgroundColor: EditorColor.selection]
        // A link's color is a rendering attribute like every other; the
        // storage's link attribute only makes it clickable.
        textView.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        textView.typingAttributes = Coordinator.baseAttributes
        textView.textContainerInset = inset
        textView.measure = measure
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.heightTracksTextView = false
        textView.textContainer?.lineFragmentPadding = 0
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = .zero
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        textView.setAccessibilityLabel("Note text")
        textView.delegate = context.coordinator
        textView.textStorage?.delegate = context.coordinator
        textView.onFocusChange = onFocusChange

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.focusRingType = .none
        context.coordinator.textView = textView
        return scrollView
    }

    // The scroll view takes what it is offered; its own fitting size is
    // the document's, which would size the pane to the note.
    func sizeThatFits(
        _ proposal: ProposedViewSize, nsView: NSScrollView, context: Context
    ) -> CGSize? {
        proposal.replacingUnspecifiedDimensions(by: .zero)
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        coordinator.note = note
        coordinator.index = index
        coordinator.onEdit = onEdit
        coordinator.follow = follow
        coordinator.addChip = addChip
        // The app's parse is the view's own, echoed back: nothing to write —
        // though under a new path it is the note on show renamed, which a
        // later reload must not take for a different note.
        guard parsed != coordinator.presented else {
            coordinator.renamed(to: note.path)
            return
        }
        coordinator.show(parsed, in: scrollView)
    }

    /// The view's delegate on both sides of the text. Once the storage has
    /// processed a change to its characters — typed, pasted, or undone —
    /// the text is parsed, fonts and links set in the storage, and the
    /// parse reported up; colors follow as rendering attributes once the
    /// layout manager has caught up with the change.
    final class Coordinator: NSObject, NSTextViewDelegate, NSTextStorageDelegate {
        var note: Note
        var index: Index
        var onEdit: (ParsedNote) -> Void
        var follow: (BodyLink.Destination) -> Void
        var addChip: (String) -> Void
        weak var textView: EditorTextView?
        /// The parse the view showed last, or reported last — what the
        /// app hands back until the note changes underneath.
        private(set) var presented: ParsedNote?
        /// The path of the note on show; a different one starts undo afresh.
        private var presentedPath: String?
        /// The parse being written into the view, while it is, so the
        /// storage's processing of it neither parses the same text again nor
        /// reports it up.
        private var beingShown: ParsedNote?
        private var links: [BodyLink] = []
        /// The body tags of the parse on show, as written, in order.
        private var tags: [String] = []
        private var styledRanges: [StyledRange] = []
        /// Whether the styled ranges have changed since the layout manager
        /// was last given their colors.
        private var needsRendering = false
        private var isRenderingScheduled = false
        // ADR 0013: undo is per note, so the view's own manager, not the
        // window's, emptied on a note switch.
        private let undoManager = UndoManager()

        /// A link's storage attribute: this scheme and its index in `links`,
        /// a URL because AppKit expects one there — its Copy Link and Open
        /// Link would cast — and the scheme is nothing the system opens.
        private static let linkScheme = "vitrine-link"
        /// A tag's, likewise: this scheme and its index in `tags`. A link
        /// attribute because that is what the view tracks a click on
        /// without moving the caret; following it adds a chip.
        private static let tagScheme = "vitrine-tag"

        /// What every character carries unless a styled range says otherwise.
        static let baseAttributes: [NSAttributedString.Key: Any] = [
            .font: EditorFont.body,
            .foregroundColor: NSColor(resource: .fg),
            .paragraphStyle: EditorFont.paragraphStyle,
        ]

        init(
            note: Note, index: Index, onEdit: @escaping (ParsedNote) -> Void,
            follow: @escaping (BodyLink.Destination) -> Void,
            addChip: @escaping (String) -> Void
        ) {
            self.note = note
            self.index = index
            self.onEdit = onEdit
            self.follow = follow
            self.addChip = addChip
        }

        /// The note on show is now at `path` — the title field renamed it —
        /// so a reload of it keeps the caret, scroll, and undo stack.
        func renamed(to path: String) {
            presentedPath = path
        }

        /// Writes `parsed` into the view in one editing block. A different
        /// note starts at the top with a fresh undo stack; the same note
        /// changed underneath keeps its caret and scroll where the new text
        /// allows.
        func show(_ parsed: ParsedNote, in scrollView: NSScrollView) {
            guard let textView, let storage = textView.textStorage else { return }
            let isSameNote = presentedPath == note.path
            let selection = textView.selectedRange()
            let scrolled = scrollView.contentView.bounds.origin
            presentedPath = note.path
            beingShown = parsed
            storage.beginEditing()
            // Attributed, since text put into an empty storage carries none,
            // and the color and paragraph style are set nowhere else.
            storage.replaceCharacters(
                in: NSRange(location: 0, length: storage.length),
                with: NSAttributedString(string: parsed.text, attributes: Self.baseAttributes))
            storage.endEditing()
            beingShown = nil
            renderIfNeeded()
            if isSameNote {
                let end = storage.length
                textView.setSelectedRange(
                    NSRange(
                        location: min(selection.location, end),
                        length: min(selection.length, end - min(selection.location, end))))
                scrollView.contentView.scroll(to: scrolled)
            } else {
                undoManager.removeAllActions()
                textView.setSelectedRange(NSRange(location: 0, length: 0))
                scrollView.contentView.scroll(to: .zero)
            }
            scrollView.reflectScrolledClipView(scrollView.contentView)
        }

        // MARK: NSTextStorageDelegate

        // Every change to the characters comes through here, an undo
        // included, which the view's own delegate is not told of. After the
        // storage has processed it, not before (ADR 0013, Update): an
        // attribute set while it is processing widens the edited range, and
        // the view then puts the caret at that range's end — typing `# ` at
        // a line's start would send it to the line's end.
        func textStorage(
            _ storage: NSTextStorage, didProcessEditing editedMask: NSTextStorageEditActions,
            range editedRange: NSRange, changeInLength delta: Int
        ) {
            guard editedMask.contains(.editedCharacters) else { return }
            if let beingShown {
                present(beingShown, in: storage)
                return
            }
            let parsed = parse(storage.string)
            present(parsed, in: storage)
            onEdit(parsed)
        }

        // MARK: NSTextViewDelegate

        // The view's edit is complete and the layout manager has caught up:
        // the moment for the colors, before anything is drawn.
        func textDidChange(_ notification: Notification) {
            renderIfNeeded()
        }

        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            guard let url = link as? URL, let index = url.host().flatMap(Int.init) else {
                return false
            }
            switch url.scheme {
            case Self.linkScheme where links.indices.contains(index):
                follow(links[index].destination)
            case Self.tagScheme where tags.indices.contains(index):
                addChip(tags[index])
            default:
                return false
            }
            return true
        }

        func undoManager(for view: NSTextView) -> UndoManager? {
            undoManager
        }

        // MARK: Attributes

        // The storage's string is bridged from NSString; the parser and the
        // range conversion both read UTF-8, so one native copy serves both.
        private func parse(_ bridged: String) -> ParsedNote {
            var text = bridged
            text.makeContiguousUTF8()
            return ParsedNote.parse(text)
        }

        /// `parsed` — the text the storage now holds — as what the view
        /// shows: its fonts and links into the storage now, its colors
        /// once the layout manager has caught up with the text.
        private func present(_ parsed: ParsedNote, in storage: NSTextStorage) {
            presented = parsed
            links = BodyLink.all(in: parsed, of: note, index: index)
            tags = parsed.bodyTags.map(\.name)
            styledRanges = StyledRange.all(in: parsed, links: links)
            applyStorageAttributes(to: storage)
            needsRendering = true
            scheduleRendering()
        }

        /// The colors on the next turn of the run loop, for a change the
        /// view does not follow with `textDidChange` — an undo — which the
        /// layout manager will have caught up with by then.
        private func scheduleRendering() {
            guard !isRenderingScheduled else { return }
            isRenderingScheduled = true
            DispatchQueue.main.async { [weak self] in
                self?.isRenderingScheduled = false
                self?.renderIfNeeded()
            }
        }

        private func renderIfNeeded() {
            guard needsRendering else { return }
            needsRendering = false
            applyRenderingAttributes()
        }

        /// Fonts, links, and the unresolved underline — the storage's
        /// attributes — set only where what is in place differs, so an edit
        /// invalidates the layout of the lines it changed and not the whole
        /// note. An unresolved link is a link too: following it creates its
        /// note; and a tag is one, so a click on it adds a chip — except
        /// inside a link's own token, which stays the link's. The color and
        /// paragraph style are uniform: loaded with the text, typed with
        /// the typing attributes.
        private func applyStorageAttributes(to storage: NSTextStorage) {
            for span in StyledRange.fontSpans(of: styledRanges, length: storage.length) {
                storage.enumerateAttribute(.font, in: span.range) { current, range, _ in
                    guard (current as? NSFont) != span.font else { return }
                    storage.addAttribute(.font, value: span.font, range: range)
                }
            }
            var links: [NSRange: URL] = [:]
            var underlines: [NSRange: Int] = [:]
            for styled in styledRanges {
                if case .link(let index, let isResolved) = styled.kind {
                    links[styled.range] = URL(string: "\(Self.linkScheme)://\(index)")
                    if !isResolved {
                        underlines[styled.range] = StyledRange.unresolvedUnderline
                    }
                }
            }
            let linkTokens = Array(links.keys)
            for styled in styledRanges {
                guard case .tag(let index) = styled.kind else { continue }
                let isInsideLink = linkTokens.contains {
                    NSIntersectionRange($0, styled.range).length > 0
                }
                if !isInsideLink {
                    links[styled.range] = URL(string: "\(Self.tagScheme)://\(index)")
                }
            }
            reconcile(.link, to: links, in: storage)
            reconcile(.underlineStyle, to: underlines, in: storage)
        }

        /// `key` set over exactly the ranges in `wanted`, touching only the
        /// runs that differ.
        private func reconcile<Value: Equatable>(
            _ key: NSAttributedString.Key, to wanted: [NSRange: Value], in storage: NSTextStorage
        ) {
            var inPlace: [NSRange: Value] = [:]
            storage.enumerateAttribute(key, in: NSRange(location: 0, length: storage.length)) {
                current, range, _ in
                guard let value = current as? Value else { return }
                if wanted[range] == value {
                    inPlace[range] = value
                } else {
                    storage.removeAttribute(key, range: range)
                }
            }
            for (range, value) in wanted where inPlace[range] != value {
                storage.addAttribute(key, value: value, range: range)
            }
        }

        /// Colors, underlines, and backgrounds — rendering attributes, which
        /// change no layout — the editor's own keys cleared and set afresh
        /// from the styled ranges; the view's own rendering attributes
        /// (spelling, marked text) are not touched.
        private func applyRenderingAttributes() {
            guard let layoutManager = textView?.textLayoutManager,
                let contentManager = layoutManager.textContentManager
            else { return }
            let document = layoutManager.documentRange
            for key in StyledRange.renderingKeys {
                layoutManager.removeRenderingAttribute(key, for: document)
            }
            for styled in styledRanges {
                guard
                    let start = contentManager.location(
                        document.location, offsetBy: styled.range.location),
                    let end = contentManager.location(start, offsetBy: styled.range.length),
                    let range = NSTextRange(location: start, end: end)
                else { continue }
                for (key, value) in styled.renderingAttributes {
                    layoutManager.addRenderingAttribute(key, value: value, for: range)
                }
            }
        }
    }
}
