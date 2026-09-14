/// One resolved link with the line it was written on.
struct LinkInContext: Sendable {
    let link: ResolvedLink
    let context: ContextLine
}
