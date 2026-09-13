import CoreGraphics

/// The brief's type scale (1.22 ratio), one named step per size. Every type
/// size in the app is one of these; nothing is set below `label`.
enum TypeScale: CGFloat {
    /// 11 px — caps section labels, mono counts.
    case label = 11
    /// 12 px — metadata, the library name in the title bar.
    case caption = 12
    /// 13 px — dense chrome: tabs, sidebar rows, the app name.
    case compact = 13
    /// 14 px — the product default.
    case body = 14
    /// 16 px
    case lead = 16
    /// 18 px
    case subheading = 18
    /// 21 px
    case heading = 21
    /// 25 px
    case title = 25
    /// 31 px
    case display = 31
    /// 39 px
    case hero = 39
    /// 49 px
    case poster = 49
    /// 61 px
    case marquee = 61
}
