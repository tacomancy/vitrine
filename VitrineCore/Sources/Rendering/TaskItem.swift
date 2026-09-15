/// One item of a task list: its checkbox state and the blocks it holds.
public struct TaskItem: Sendable, Equatable {
    /// Whether the item was written `[x]` rather than `[ ]`.
    public let isChecked: Bool
    /// The item's content.
    public let blocks: [Block]

    /// Memberwise, so a test's expected value can be written as a literal.
    public init(isChecked: Bool, blocks: [Block]) {
        self.isChecked = isChecked
        self.blocks = blocks
    }
}
