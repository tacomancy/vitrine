import Foundation
import Testing

@Suite struct FixtureLibraryTests {
    @Test func fixture_library_is_reachable_as_a_package_resource() throws {
        let fixture = try #require(
            Bundle.module.url(forResource: "minimal", withExtension: nil, subdirectory: "Fixtures")
        )
        var isDirectory: ObjCBool = false
        #expect(FileManager.default.fileExists(atPath: fixture.path, isDirectory: &isDirectory))
        #expect(isDirectory.boolValue)

        let notes = try FileManager.default.contentsOfDirectory(atPath: fixture.path)
            .filter { $0.hasSuffix(".md") }
        #expect(notes.count == 1)
    }
}
