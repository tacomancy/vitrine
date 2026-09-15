import Library
import Search
import SwiftUI

/// The command palette (CONTEXT.md § Command palette): the `bg-overlay`
/// scrim over the inert window and the 760 px `bg-surface` panel — the
/// header with the query, the results column beside the preview rail, and
/// the footer with the key hints and the count. NOTES lists what `Search`
/// answered for the query, with the terms washed — or Recent while the
/// query is empty; ACTIONS lists the app's commands, filtered by the same
/// query. ↑↓ move the highlight over both as one list; ↩ or a click opens
/// the highlighted note as following a link does, or runs the action, and
/// closes; Esc closes; ⌘⌫ clears.
struct CommandPalette: View {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection
    let buffer: NoteBuffer
    let palette: PaletteState
    @Binding var selectedTab: Tab

    @FocusState private var isQueryFocused: Bool

    var body: some View {
        let rows = rows
        let highlighted = highlightedRow(among: rows)
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color(.bgOverlay)
                    .contentShape(Rectangle())
                    .onTapGesture { palette.close() }
                VStack(spacing: 0) {
                    header(rows: rows, highlighted: highlighted)
                    HStack(alignment: .top, spacing: 0) {
                        column(rows: rows, highlighted: highlighted)
                        PreviewRail(
                            row: highlighted.map { rows[$0] }, index: currentLibrary.index,
                            search: currentLibrary.search)
                    }
                    .frame(height: bodyHeight(in: geometry.size.height))
                    footer
                }
                .frame(width: PaletteMetrics.panelWidth)
                .background(Color(.bgSurface), in: RoundedRectangle(cornerRadius: Radius.large))
                .padding(.top, PaletteMetrics.panelTopInset)
            }
        }
        .ignoresSafeArea()
        .defaultFocus($isQueryFocused, true)
        .task { isQueryFocused = true }
        // A save or another tool's change while the palette is open: the
        // results are answered again by the Search that replaced the one
        // they came from.
        .onChange(of: currentLibrary.library) { palette.runQuery() }
    }

    // MARK: Rows

    /// NOTES then ACTIONS, the one list the highlight moves over.
    private var rows: [PaletteRow] {
        noteRows + actions.map(PaletteRow.action)
    }

    private var isQueryEmpty: Bool {
        query.isEmpty
    }

    /// The query without surrounding whitespace: what a title is compared
    /// to, and what a note is titled.
    private var query: String {
        palette.query.trimmingCharacters(in: .whitespaces)
    }

    /// Recent for an empty query — the open note left out, so ↩ on the first
    /// row returns to the note before it — and the results otherwise.
    private var noteRows: [PaletteRow] {
        if isQueryEmpty {
            selection.recent.filter { $0.path != selection.openNote?.path }.map(PaletteRow.recent)
        } else {
            palette.results.map(PaletteRow.result)
        }
    }

    /// Every command that can run now, filtered by substring on its label
    /// when there is a query.
    private var actions: [PaletteAction] {
        var actions: [PaletteAction] = []
        if let library = currentLibrary.library {
            actions.append(.newUntitledNote)
            if !isQueryEmpty, !isTitleTaken(in: library) {
                actions.append(.newNote(titled: query))
            }
        }
        actions.append(.openLibrary)
        if selection.canGoBack { actions.append(.back) }
        if selection.canGoForward { actions.append(.forward) }
        actions.append(contentsOf: [.goToNotes, .goToTags])
        guard !isQueryEmpty else { return actions }
        return actions.filter { $0.label.localizedCaseInsensitiveContains(query) }
    }

    /// Whether a note's title is the query already, compared as the file
    /// system compares names.
    private func isTitleTaken(in library: Library) -> Bool {
        library.allNotes.contains { $0.title.caseInsensitiveCompare(query) == .orderedSame }
    }

    private func highlightedRow(among rows: [PaletteRow]) -> Int? {
        rows.isEmpty ? nil : min(palette.highlightedRow, rows.count - 1)
    }

    // MARK: Header

    private func header(rows: [PaletteRow], highlighted: Int?) -> some View {
        HStack(spacing: PaletteMetrics.headerSpacing) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: PaletteMetrics.glyphSize))
                .foregroundStyle(Color(.link))
                .accessibilityHidden(true)
            TextField("Search", text: queryBinding)
                .textFieldStyle(.plain)
                .font(.sans(.lead, weight: .regular))
                .foregroundStyle(Color(.fg))
                .focused($isQueryFocused)
                .focusEffectDisabled()
                .accessibilityLabel("Search")
                .onSubmit { open(rows, at: highlighted) }
                .onKeyPress(.upArrow) {
                    palette.moveHighlight(by: -1, among: rows.count)
                    return .handled
                }
                .onKeyPress(.downArrow) {
                    palette.moveHighlight(by: 1, among: rows.count)
                    return .handled
                }
                .onKeyPress(.escape) {
                    palette.close()
                    return .handled
                }
                .onKeyPress(.delete, phases: .down) { press in
                    guard press.modifiers.contains(.command) else { return .ignored }
                    palette.clear()
                    return .handled
                }
        }
        .padding(PaletteMetrics.headerPadding)
    }

    private var queryBinding: Binding<String> {
        Binding(get: { palette.query }, set: { palette.update(query: $0) })
    }

    // MARK: Results

    private func column(rows: [PaletteRow], highlighted: Int?) -> some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    let notes = rows.count { $0.note != nil }
                    groupLabel(isQueryEmpty ? "Recent" : "Notes", count: notes)
                    if notes == 0 {
                        Text(isQueryEmpty ? "No notes opened yet." : "No notes match.")
                            .font(.sans(.caption, weight: .regular))
                            .foregroundStyle(Color(.fgMuted))
                            .padding(.horizontal, PaletteMetrics.inset)
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { offset, row in
                        if case .action = row, offset == notes {
                            groupLabel("Actions", count: nil)
                                .padding(.top, PaletteMetrics.columnPaddingVertical)
                        }
                        PaletteResultRow(
                            row: row, isHighlighted: offset == highlighted,
                            highlight: { palette.highlight(offset) },
                            open: { open(rows, at: offset) }
                        )
                        .id(offset)
                    }
                }
                .padding(.vertical, PaletteMetrics.columnPaddingVertical)
            }
            .onChange(of: highlighted) {
                if let highlighted { scroll.scrollTo(highlighted) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func groupLabel(_ text: String, count: Int?) -> some View {
        CapsLabel(
            text: count.map { "\(text) · \($0.formatted())" } ?? text, color: Color(.fgMuted)
        )
        .padding(PaletteMetrics.groupLabelPadding)
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: PaletteMetrics.footerSpacing) {
            keyHint("↑↓", "navigate")
            keyHint("↩", "open")
            keyHint("esc", "close")
            keyHint("⌘⌫", "clear")
            Spacer()
            Text("\(noteRows.count.formatted()) notes")
                .font(.mono(.label, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
        }
        .padding(PaletteMetrics.footerPadding)
    }

    /// A key in brass — punctuation (rule 3) — and what it does.
    private func keyHint(_ key: String, _ verb: String) -> some View {
        HStack(spacing: PaletteMetrics.keySpacing) {
            Text(key)
                .font(.mono(.label, weight: .regular))
                .foregroundStyle(Color(.accent))
            Text(verb)
                .font(.sans(.label, weight: .regular))
                .foregroundStyle(Color(.fgMuted))
        }
    }

    // MARK: Opening

    /// ↩ or a click on the row at `offset`: a note opens as following a
    /// link does — history pushed, scope unchanged — and an action runs;
    /// either closes the palette.
    private func open(_ rows: [PaletteRow], at offset: Int?) {
        guard let offset, rows.indices.contains(offset) else { return }
        palette.close()
        switch rows[offset] {
        case .result(let result): selection.open(result.note)
        case .recent(let note): selection.open(note)
        case .action(let action): run(action)
        }
    }

    private func run(_ action: PaletteAction) {
        let commands = WindowCommands(
            currentLibrary: currentLibrary, selection: selection, buffer: buffer)
        switch action {
        case .newUntitledNote: commands.newUntitledNote()
        case .newNote(let title): commands.newNote(titled: title)
        case .openLibrary: commands.openLibrary()
        case .back: selection.goBack()
        case .forward: selection.goForward()
        case .goToNotes: selectedTab = .notes
        case .goToTags: selectedTab = .tags
        }
    }

    /// The results column and rail take the mockup's height where the
    /// window allows, and less in a short window so the footer stays on
    /// screen.
    private func bodyHeight(in windowHeight: CGFloat) -> CGFloat {
        let available =
            windowHeight - PaletteMetrics.panelTopInset - PaletteMetrics.panelBottomInset
            - Self.headerHeight - Self.footerHeight
        return min(PaletteMetrics.bodyHeight, max(Self.minimumBodyHeight, available))
    }

    private static let headerHeight: CGFloat = 52
    private static let footerHeight: CGFloat = 36
    private static let minimumBodyHeight: CGFloat = 160
}
