import SwiftUI

/// The brief's SOON treatment: a caps label in brass with a quiet brass
/// border. Brass as punctuation (rule 3), never a fill.
struct SoonBadge: View {
    private static let borderWidth: CGFloat = 1
    private static let horizontalPadding: CGFloat = 4
    private static let verticalPadding: CGFloat = 1

    var body: some View {
        CapsLabel(text: "Soon", color: Color(.accent))
            .padding(.horizontal, Self.horizontalPadding)
            .padding(.vertical, Self.verticalPadding)
            .overlay {
                RoundedRectangle(cornerRadius: Radius.medium)
                    .stroke(Color(.accentQuiet), lineWidth: Self.borderWidth)
            }
    }
}
