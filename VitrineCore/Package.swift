// swift-tools-version: 6.2

// ADR 0006 (Update): warnings-as-errors is NOT set here. Xcode builds local
// package targets with -suppress-warnings and rejects treatAllWarnings(as:) as
// a conflicting option; Scripts/test.sh enforces it for every target instead.
//
// ADR 0006: one package, one target per seam. The `VitrineCore` target below
// is the scaffold's placeholder — it proves the build and the red→green loop
// and nothing else. The first feature ticket deletes it and adds the first
// real seam in its place.

import PackageDescription

let package = Package(
    name: "VitrineCore",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "VitrineCore", targets: ["VitrineCore"])
    ],
    targets: [
        .target(
            name: "VitrineCore",
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
        .testTarget(
            name: "VitrineCoreTests",
            dependencies: ["VitrineCore"],
            // CODING_STANDARDS §6: fixture libraries are real folders, shipped as
            // package resources so tests never depend on the working directory.
            resources: [.copy("Fixtures")],
            swiftSettings: [
                .defaultIsolation(nil)
            ]
        ),
    ]
)
