// PROTOTYPE — throwaway, not production. Lives on prototype/window-chrome only.
//
// Question (ADR 0008): does a macOS 26 NavigationSplitView sidebar take an
// opaque token fill under a drawn title bar and tab strip, or does Liquid
// Glass bleed through? Three variants on the main window, switchable from
// the floating bar or with ← / →:
//
//   A  drawn chrome + NavigationSplitView, sidebar background overridden  (ADR 0008 as proposed)
//   B  drawn chrome + HSplitView                                           (ADR 0008 fallback)
//   C  native chrome: NavigationSplitView + system toolbar, tokens on content only (rejected baseline)
//
// Colors are the brief's dark tokens by value. Type is the system font at the
// brief's sizes — fonts are not bundled yet (ADR 0009); the question is about
// materials, not type. Sample content is placeholder.

import SwiftUI

// MARK: - Tokens (design/vitrine-design-system-brief.md, dark)

enum Token {
    static let bg = Color(hex: 0x09111D)
    static let bgSurface = Color(hex: 0x121A25)
    static let bgRaised = Color(hex: 0x1C232F)
    static let bgSunken = Color(hex: 0x020713)
    static let fg = Color(hex: 0xD0D8E4)
    static let fgSecondary = Color(hex: 0xB2BBC9)
    static let fgMuted = Color(hex: 0x9099A7)
    static let fgDisabled = Color(hex: 0x707885)
    static let accent = Color(hex: 0xE5B64A)
    static let link = Color(hex: 0x9ABFFA)
    static let line = Color(hex: 0x2C333E)
    static let lineStrong = Color(hex: 0x3F4550)
    static let lineControl = Color(hex: 0x707885)
    static let primary = Color(hex: 0x2062C7)
    static let infoBg = Color(hex: 0x011D4B)
    static let infoLine = Color(hex: 0x0C49A0)
    static let markTop = Color(hex: 0x053274)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

// MARK: - Switcher

enum ChromeVariant: String, CaseIterable {
    case a, b, c, d, e

    var title: String {
        switch self {
        case .a: "Drawn chrome + NavigationSplitView (ADR 0008)"
        case .b: "Drawn chrome + HSplitView (fallback)"
        case .c: "Native chrome (rejected baseline)"
        case .d: "B, softened: 5px surfaces, no hairlines"
        case .e: "Floating surfaces: 8px gutters, no dividers (HStack, look only)"
        }
    }
}

struct WindowChromePrototype: View {
    // `open Vitrine.app --args -variant b` picks the starting variant.
    @State private var variant: ChromeVariant =
        ChromeVariant(rawValue: UserDefaults.standard.string(forKey: "variant") ?? "a") ?? .a

    var body: some View {
        ZStack(alignment: .bottom) {
            switch variant {
            case .a: VariantA()
            case .b: VariantB()
            case .c: VariantC()
            case .d: VariantD().environment(\.softChrome, true)
            case .e: VariantE().environment(\.softChrome, true)
            }
            switcher
        }
        .background {
            // Hidden buttons so ← / → cycle variants without a focused control.
            Group {
                Button("") { cycle(by: -1) }.keyboardShortcut(.leftArrow, modifiers: [])
                Button("") { cycle(by: 1) }.keyboardShortcut(.rightArrow, modifiers: [])
            }
            .opacity(0)
            .frame(width: 0, height: 0)
        }
        .preferredColorScheme(.dark)
    }

    private var switcher: some View {
        HStack(spacing: 12) {
            Button("←") { cycle(by: -1) }
            Text("\(variant.rawValue.uppercased()) · \(variant.title)")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
            Button("→") { cycle(by: 1) }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .foregroundStyle(.black)
        .background(Color(hex: 0xFFD400), in: Capsule())
        .shadow(radius: 8)
        .padding(.bottom, 16)
    }

    private func cycle(by offset: Int) {
        let all = ChromeVariant.allCases
        let next = (all.firstIndex(of: variant)! + offset + all.count) % all.count
        variant = all[next]
    }
}

// MARK: - Variants

struct VariantA: View {
    // `-splitFix none|keepToolbar|inset` tries alternatives when the drawn title bar vanishes.
    private let fix = UserDefaults.standard.string(forKey: "splitFix") ?? "none"

    var body: some View {
        DrawnChrome {
            splitView
        }
    }

    @ViewBuilder private var splitView: some View {
        let base = NavigationSplitView {
            SidebarContent()
                .navigationSplitViewColumnWidth(min: 196, ideal: 212, max: 280)
        } content: {
            NoteListPane()
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 404)
        } detail: {
            EditorPane()
        }
        .navigationSplitViewStyle(.balanced)

        switch fix {
        case "keepToolbar":
            base
        case "inset":
            // Let the split view own the safe area; chrome pushes it down instead of overlapping.
            base.toolbar(.hidden, for: .windowToolbar).ignoresSafeArea(edges: [])
        default:
            base.toolbar(.hidden, for: .windowToolbar)
        }
    }
}

struct VariantB: View {
    var body: some View {
        DrawnChrome {
            HSplitView {
                SidebarContent()
                    .frame(minWidth: 196, idealWidth: 212, maxWidth: 280)
                NoteListPane()
                    .frame(minWidth: 260, idealWidth: 300, maxWidth: 404)
                EditorPane()
                    .frame(minWidth: 400, maxWidth: .infinity)
            }
        }
    }
}

struct VariantC: View {
    var body: some View {
        NavigationSplitView {
            SidebarContent(overrideBackground: false)
                .navigationSplitViewColumnWidth(min: 196, ideal: 212, max: 280)
        } content: {
            NoteListPane()
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 404)
        } detail: {
            EditorPane()
        }
        .navigationTitle("Vitrine")
        .navigationSubtitle("Wan Shi Tong's Library")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Tab", selection: .constant(0)) {
                    Text("Notes").tag(0)
                    Text("Sources").tag(1)
                    Text("Ideas").tag(2)
                    Text("Dashboard").tag(3)
                    Text("Tags").tag(4)
                }
                .pickerStyle(.segmented)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                } label: {
                    Label("Search", systemImage: "magnifyingglass")
                }
            }
        }
    }
}

// Soft treatment (variant D): 5px surfaces on bg with gutters, no decorative hairlines.
private struct SoftChromeKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var softChrome: Bool {
        get { self[SoftChromeKey.self] }
        set { self[SoftChromeKey.self] = newValue }
    }
}

struct VariantD: View {
    var body: some View {
        DrawnChrome {
            HSplitView {
                SidebarContent()
                    .frame(minWidth: 196, idealWidth: 212, maxWidth: 280)
                NoteListPane()
                    .frame(minWidth: 260, idealWidth: 300, maxWidth: 404)
                    .padding(.vertical, 8)
                    .padding(.leading, 2)
                EditorPane()
                    .frame(minWidth: 400, maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .padding(.trailing, 8)
                    .padding(.leading, 2)
            }
            .background(Token.bg)
        }
    }
}

struct VariantE: View {
    var body: some View {
        DrawnChrome {
            HStack(spacing: 8) {
                SidebarContent()
                    .frame(width: 212)
                NoteListPane()
                    .frame(width: 300)
                EditorPane()
                    .frame(maxWidth: .infinity)
            }
            .padding(8)
            .background(Token.bg)
        }
    }
}

// MARK: - Drawn chrome (A, B, D, E)

struct DrawnChrome<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            TitleBar()
            TabStrip()
            content
        }
        .background(Token.bg)
        .ignoresSafeArea()
    }
}

struct TitleBar: View {
    @Environment(\.softChrome) private var soft

    var body: some View {
        HStack(spacing: 10) {
            // Room for the system traffic lights.
            Color.clear.frame(width: 68)
            ZStack {
                RoundedRectangle(cornerRadius: 2)
                    .fill(
                        LinearGradient(
                            colors: [Token.markTop, Token.bgSunken], startPoint: .topLeading,
                            endPoint: .bottomTrailing)
                    )
                    .frame(width: 22, height: 22)
                Circle().fill(Token.accent).frame(width: 7, height: 7)
            }
            Text("Vitrine").font(.system(size: 13, weight: .semibold)).foregroundStyle(Token.fg)
            Text("— Wan Shi Tong's Library").font(.system(size: 13)).foregroundStyle(Token.fgMuted)
            Spacer()
            HStack {
                Image(systemName: "magnifyingglass").font(.system(size: 11))
                Text("Search").font(.system(size: 12))
                Spacer()
                Text("⌘K").font(.system(size: 11, design: .monospaced))
            }
            .foregroundStyle(Token.fgMuted)
            .padding(.horizontal, 8)
            .frame(width: 200, height: 24)
            .background(Token.bgSurface, in: RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Token.lineControl, lineWidth: 1))
            .padding(.trailing, 12)
        }
        .frame(height: 38)
        .background(Token.bgRaised)
        .overlay(alignment: .bottom) { if !soft { Token.line.frame(height: 1) } }
        .gesture(WindowDragGesture())
    }
}

struct TabStrip: View {
    @Environment(\.softChrome) private var soft
    private let tabs: [(String, Bool)] = [
        ("Notes", true), ("Sources", true), ("Ideas", false), ("Dashboard", false), ("Tags", true),
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                HStack(spacing: 8) {
                    Group {
                        if tab.1 {
                            Rectangle().fill(index == 0 ? Token.accent : Token.fgMuted)
                        } else {
                            Circle().fill(index == 0 ? Token.accent : Token.fgMuted)
                        }
                    }
                    .frame(width: 6, height: 6)
                    Text(tab.0).font(.system(size: 13)).foregroundStyle(
                        index == 0 ? Token.fg : Token.fgMuted)
                }
                .padding(.horizontal, 14)
                .frame(height: 31)
                .background(
                    index == 0 ? Token.bgRaised : .clear,
                    in: UnevenRoundedRectangle(
                        topLeadingRadius: soft ? 3 : 0, topTrailingRadius: soft ? 3 : 0)
                )
                .overlay(alignment: .bottom) { if index == 0 { Token.primary.frame(height: 2) } }
            }
            Text("+").font(.system(size: 13)).foregroundStyle(Token.fgMuted).padding(
                .horizontal, 14)
            Spacer()
        }
        .frame(height: 31)
        .background(Token.bg)
        .overlay(alignment: .bottom) { if !soft { Token.line.frame(height: 1) } }
    }
}

// MARK: - Panes (shared by all variants)

struct SidebarContent: View {
    @Environment(\.softChrome) private var soft
    var overrideBackground = true

    var body: some View {
        let list = List {
            Section {
                sidebarRow("All Notes", count: "79", selected: true)
            } header: {
                sectionLabel("LIBRARY")
            }
            Section {
                folderRow("Course Notes", depth: 0, open: true)
                folderRow("Coursera", depth: 1, open: false)
                noteRow("lewenstein2025ProbabilityAndStatistics", depth: 1)
                folderRow("Literature Notes", depth: 0, open: false)
                folderRow("Research Notes", depth: 0, open: true)
                folderRow("AI ML GenAI etc", depth: 1, open: false)
                folderRow("Data Science", depth: 1, open: true)
                noteRow("Feature Engineering", depth: 2)
                noteRow("Hypothesis Testing", depth: 2)
                folderRow("Attachments", depth: 0, open: false)
            } header: {
                sectionLabel("FILES")
            }
        }
        .listStyle(.sidebar)
        .environment(\.defaultMinListRowHeight, 24)

        if overrideBackground {
            list
                .scrollContentBackground(.hidden)
                .background(Token.bg)
                .safeAreaInset(edge: .bottom, spacing: 0) { scoutsStub }
        } else {
            list.safeAreaInset(edge: .bottom, spacing: 0) { scoutsStub }
        }
    }

    private var scoutsStub: some View {
        HStack {
            Text("SCOUTS").font(.system(size: 11, design: .monospaced)).kerning(1.5)
                .foregroundStyle(Token.fgMuted)
            Text("SOON").font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(Token.accent).padding(.horizontal, 5).padding(.vertical, 1)
                .overlay(RoundedRectangle(cornerRadius: 2).stroke(Token.accent, lineWidth: 1))
            Spacer()
        }
        .padding(12)
        .overlay(alignment: .top) { if !soft { Token.line.frame(height: 1) } }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text).font(.system(size: 11, design: .monospaced)).kerning(1.5).foregroundStyle(
            Token.fgMuted)
    }

    private func sidebarRow(_ title: String, count: String, selected: Bool) -> some View {
        HStack {
            Image(systemName: "doc.text").font(.system(size: 11)).foregroundStyle(
                selected ? Token.link : Token.fgMuted)
            Text(title).font(.system(size: 12.5)).foregroundStyle(
                selected ? Token.fg : Token.fgSecondary)
            Spacer()
            Text(count).font(.system(size: 11, design: .monospaced)).foregroundStyle(Token.fgMuted)
        }
        .listRowBackground(selected ? Token.bgRaised : .clear)
        .overlay(alignment: .leading) {
            if selected { Token.primary.frame(width: 2).padding(.leading, -8) }
        }
    }

    private func folderRow(_ name: String, depth: Int, open: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 9))
                .foregroundStyle(Token.fgMuted).frame(width: 10)
            Image(systemName: "folder").font(.system(size: 11)).foregroundStyle(Token.fgMuted)
            Text(name).font(.system(size: 12.5)).foregroundStyle(Token.fgSecondary)
        }
        .padding(.leading, CGFloat(depth) * 14)
        .listRowBackground(Color.clear)
    }

    private func noteRow(_ name: String, depth: Int) -> some View {
        HStack(spacing: 6) {
            Color.clear.frame(width: 10)
            Image(systemName: "doc").font(.system(size: 11)).foregroundStyle(Token.fgMuted)
            Text(name).font(.system(size: 12.5)).foregroundStyle(Token.fgSecondary).lineLimit(1)
        }
        .padding(.leading, CGFloat(depth) * 14)
        .listRowBackground(Color.clear)
    }
}

struct NoteListPane: View {
    @Environment(\.softChrome) private var soft
    private let notes: [(String, String)] = [
        ("Feature Engineering", "Sep 12"), ("Hypothesis Testing", "Sep 10"),
        ("Distance Measurements", "Sep 9"),
        ("Dimensionality Reduction", "Sep 4"), ("Descriptive Statistics", "Aug 30"),
        ("Data Cleaning", "Aug 28"),
        ("Frequentist vs. Bayesian Statistics", "Aug 21"), ("Visualizations", "Aug 19"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("8 NOTES · MODIFIED ↓").font(.system(size: 11, design: .monospaced)).kerning(
                    1.5
                ).foregroundStyle(Token.fgMuted)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 6)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(notes.enumerated()), id: \.offset) { index, note in
                        HStack {
                            Text(note.0).font(.system(size: 12.5)).foregroundStyle(
                                index == 0 ? Token.fg : Token.fgSecondary
                            ).lineLimit(1)
                            Spacer()
                            Text(note.1).font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(Token.fgMuted)
                        }
                        .padding(.horizontal, 11).padding(.vertical, 9)
                        .background(index == 0 ? Token.bgRaised : .clear)
                        .overlay(alignment: .leading) {
                            if index == 0 { Token.primary.frame(width: 2) }
                        }
                        .overlay(alignment: .bottom) { Token.line.frame(height: 1) }
                    }
                }
            }
        }
        .background(Token.bgSurface, in: RoundedRectangle(cornerRadius: soft ? 5 : 0))
        .overlay(alignment: .trailing) { if !soft { Token.lineStrong.frame(width: 1) } }
    }
}

struct EditorPane: View {
    @Environment(\.softChrome) private var soft

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Research Notes / Data Science / Feature Engineering.md")
                    .font(.system(size: 12, design: .monospaced)).foregroundStyle(Token.fgMuted)
                Spacer()
            }
            .padding(.horizontal, 24).frame(height: 34)
            .overlay(alignment: .bottom) { if !soft { Token.line.frame(height: 1) } }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Feature Engineering").font(.system(size: 25, weight: .medium))
                        .foregroundStyle(Token.fg)
                    Text(
                        """
                        ---
                        tags:
                          - data_science
                          - feature_engineering
                        ---

                        # 1 Overview / Motivation

                        Feature engineering is the work of turning raw columns into inputs a model can \
                        actually learn from: scaling, encoding categoricals, transforming skewed \
                        variables, and constructing interactions. See [[ng2025MachineLearningSpecialization]].
                        """
                    )
                    .font(.system(size: 15)).lineSpacing(7).foregroundStyle(Token.fgSecondary)
                    .textSelection(.enabled)
                }
                .frame(maxWidth: 720, alignment: .leading)
                .padding(24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Token.bgSurface, in: RoundedRectangle(cornerRadius: soft ? 5 : 0))
    }
}
