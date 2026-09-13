/// Why a fixture could not be located.
public enum FixtureError: Error, Equatable {
    /// No fixture library of that name is shipped in the bundle.
    case missing(String)
}
