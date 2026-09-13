import SwiftUI

/// The 6 px shape beside a tab's title.
enum TabMarker: View {
    case square
    case round

    private static let size: CGFloat = 6

    var body: some View {
        Group {
            switch self {
            case .square: RoundedRectangle(cornerRadius: Radius.small)
            case .round: Circle()
            }
        }
        .frame(width: Self.size, height: Self.size)
    }
}
