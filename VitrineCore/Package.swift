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
        .library(name: "Index", targets: ["Index"]),
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
            dependencies: ["Library", "Fixtures"],
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
        // ADR 0006 (Index-seam Update): not a seam — the one test-support
        // target, so every test target opens the same fixture libraries.
        // Under Tests/, it sits outside the coverage gate by construction.
        .target(
            name: "Fixtures",
            path: "Tests/Fixtures",
            // CODING_STANDARDS §6: fixture libraries are real folders, shipped as
            // package resources so tests never depend on the working directory.
            resources: [.copy("Libraries")],
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
        .target(
            name: "Index",
            dependencies: ["Library", "NoteParsing"],
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
        .testTarget(
            name: "IndexTests",
            dependencies: ["Index", "Library", "NoteParsing", "Fixtures"],
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
    ]
)
