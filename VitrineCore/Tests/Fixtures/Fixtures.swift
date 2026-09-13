import Foundation

/// The fixture libraries every test target opens, shipped once as package
/// resources so tests never depend on the working directory
/// (CODING_STANDARDS §6, ADR 0006).
public enum Fixtures {
    /// The fixture library named `name`, as it is in the bundle. Throws
    /// `FixtureError.missing` when no such fixture is shipped.
    public static func library(_ name: String) throws(FixtureError) -> URL {
        guard
            let url = Bundle.module.url(
                forResource: name, withExtension: nil, subdirectory: "Libraries")
        else { throw .missing(name) }
        return url
    }

    /// A private copy of the fixture library named `name`, for tests that
    /// break something, so the suite runs in any order and in parallel. The
    /// caller removes it.
    public static func temporaryCopy(of name: String) throws -> URL {
        let copy = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: name)
        try FileManager.default.createDirectory(
            at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: library(name), to: copy)
        return copy
    }
}

/// Why a fixture could not be located.
public enum FixtureError: Error, Equatable {
    /// No fixture library of that name is shipped in the bundle.
    case missing(String)
}
