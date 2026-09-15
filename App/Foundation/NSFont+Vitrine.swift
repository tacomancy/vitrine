import AppKit

extension NSFont {
    /// A registered face at a step of the scale, for AppKit text (ADR 0013).
    /// The face is in the bundle and registered at launch, or the launch
    /// stopped (ADR 0009): a name AppKit cannot resolve is a bug, not a
    /// case to fall back from.
    static func bundled(_ postScriptName: String, _ step: TypeScale) -> NSFont {
        guard let font = NSFont(name: postScriptName, size: step.rawValue) else {
            fatalError("Bundled font \(postScriptName) is not registered.")
        }
        return font
    }
}
