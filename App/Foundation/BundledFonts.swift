import CoreText
import Foundation

/// The two font families the app ships and registers at launch (ADR 0009).
enum BundledFonts {
    static let sansFamily = "Inter"
    static let monoFamily = "IBM Plex Mono"

    /// The PostScript names AppKit resolves a registered face by — the
    /// editor's fonts (ADR 0013). Plex Mono's are not its file names.
    enum PostScriptName {
        static let sansRegular = "Inter-Regular"
        static let sansSemiBold = "Inter-SemiBold"
        static let monoRegular = "IBMPlexMono"
    }

    /// Static weights: Inter 400–700 and Plex Mono 400–500, and nothing else.
    private static let files = [
        "Inter-Regular", "Inter-Medium", "Inter-SemiBold", "Inter-Bold",
        "IBMPlexMono-Regular", "IBMPlexMono-Medium",
    ]

    /// Registers every bundled face for this process. A missing or unloadable
    /// face stops the launch: there is no system-font fallback (ADR 0009).
    static func register() {
        for file in files {
            guard let url = Bundle.main.url(forResource: file, withExtension: "otf") else {
                fatalError("Bundled font \(file).otf is missing from the app bundle.")
            }
            var error: Unmanaged<CFError>?
            if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) { continue }
            let failure = error?.takeRetainedValue()
            // A face the user has installed system-wide is the same face, not
            // a missing one; the family still resolves.
            if let code = failure.map({ CTFontManagerError(rawValue: CFErrorGetCode($0)) }),
                code == .alreadyRegistered || code == .duplicatedName
            {
                continue
            }
            let reason = failure?.localizedDescription ?? "unknown"
            fatalError("Bundled font \(file).otf failed to register: \(reason)")
        }
    }
}
