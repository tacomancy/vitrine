import SwiftUI

/// One 24 px sidebar row: a disclosure slot, a glyph, a name, and a count.
/// Selected, it is the selected-row pill with a brass glyph — the active
/// nav item (ADR 0008; brief rules 2 and 3). With `select` it is a button;
/// without, it is inert.
struct SidebarRow: View {
    enum Disclosure {
        case none
        case collapsed
        case expanded
    }

    enum Emphasis {
        case normal
        case selected
        case disabled
    }

    /// An SF Symbol name.
    let glyph: String
    let name: String
    let count: Int?
    let depth: Int
    let disclosure: Disclosure
    let emphasis: Emphasis
    let select: (() -> Void)?

    var body: some View {
        if let select {
            RowButton(isSelected: emphasis == .selected, select: select) { content }
                .accessibilityValue(disclosureValue)
        } else {
            content
                .selectedRowPill(isSelected: false)
                .padding(.horizontal, SelectedRowPill.inset)
                .accessibilityElement(children: .combine)
        }
    }

    private var content: some View {
        HStack(spacing: SidebarMetrics.glyphSpacing) {
            HStack(spacing: SidebarMetrics.chevronSpacing) {
                chevron.frame(width: SidebarMetrics.chevronSize)
                Image(systemName: glyph)
                    .font(.system(size: SidebarMetrics.glyphSize))
                    .foregroundStyle(glyphColor)
            }
            Text(name)
                .font(.sans(.compact, weight: .regular))
                .foregroundStyle(textColor)
                .lineLimit(1)
            Spacer(minLength: SidebarMetrics.glyphSpacing)
            if let count {
                Text(count.formatted())
                    .font(.mono(.label, weight: .regular))
                    .foregroundStyle(countColor)
            }
        }
        .padding(
            .leading, SidebarMetrics.contentInset + SidebarMetrics.depthIndent * CGFloat(depth)
        )
        .padding(.trailing, SidebarMetrics.contentInset)
        .frame(height: SidebarMetrics.rowHeight)
    }

    /// The slot is kept for rows without a chevron so glyphs align at a depth.
    @ViewBuilder
    private var chevron: some View {
        if disclosure == .none {
            Color.clear
        } else {
            Image(systemName: "chevron.right")
                .font(.system(size: SidebarMetrics.chevronSize, weight: .medium))
                .foregroundStyle(Color(.fgMuted))
                .rotationEffect(disclosure == .expanded ? .degrees(90) : .zero)
                .accessibilityHidden(true)
        }
    }

    private var disclosureValue: String {
        switch disclosure {
        case .none: ""
        case .collapsed: "collapsed"
        case .expanded: "expanded"
        }
    }

    private var glyphColor: Color {
        switch emphasis {
        case .normal: Color(.fgMuted)
        case .selected: Color(.accent)
        case .disabled: Color(.fgDisabled)
        }
    }

    private var textColor: Color {
        switch emphasis {
        case .normal: Color(.fgSecondary)
        case .selected: Color(.fg)
        case .disabled: Color(.fgDisabled)
        }
    }

    private var countColor: Color {
        emphasis == .disabled ? Color(.fgDisabled) : Color(.fgMuted)
    }
}
