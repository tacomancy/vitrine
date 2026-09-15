/// Why a fixture could not be located, or a change to one could not be made.
public enum FixtureError: Error, Equatable {
    /// No fixture library of that name is shipped in the bundle.
    case missing(String)
    /// The shell script performing another tool's change exited non-zero.
    case otherToolFailed(String)
}
