// swift-tools-version: 6.2

// ADR 0006 (Update): warnings-as-errors is NOT set here. Xcode builds local
// package targets with -suppress-warnings and rejects treatAllWarnings(as:) as
// a conflicting option; Scripts/test.sh enforces it for every target instead.
//
// ADR 0006: one package, one target per seam, each named in CONTEXT.md
// vocabulary and added by the spec that needs it.

import PackageDescription

let package = Package(
    name: "VitrineCore",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Library", targets: ["Library"]),
        .library(name: "NoteParsing", targets: ["NoteParsing"]),
    ],
    dependencies: [
        // ADR 0011: Yams parses frontmatter, pinned exactly; a dependency is
        // taken only for an externally specified format we must match.
        .package(url: "https://github.com/jpsim/Yams.git", exact: "6.2.2")
    ],
    targets: [
        .target(
            name: "Library",
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
        .testTarget(
            name: "LibraryTests",
            dependencies: ["Library"],
            // CODING_STANDARDS §6: fixture libraries are real folders, shipped as
            // package resources so tests never depend on the working directory.
            resources: [.copy("Fixtures")],
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
        .target(
            name: "NoteParsing",
            dependencies: ["Yams"],
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
        .testTarget(
            name: "NoteParsingTests",
            dependencies: ["NoteParsing"],
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
    ]
)
