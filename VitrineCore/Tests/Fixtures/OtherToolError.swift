/// Why another tool's change to the library did not happen.
public enum OtherToolError: Error, Equatable {
    /// The shell script performing the change exited non-zero.
    case failed(String)
}
