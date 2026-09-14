import CoreServices
import Foundation

/// The FSEvents stream under a watch: file-level events on the library
/// root, coalesced, with this process's own writes marked (ADR 0014). The
/// one place FSEvents is named.
///
/// Unchecked because the stream handle is touched only on `queue`, which
/// FSEvents also delivers on, so nothing here is ever reached concurrently.
final class FileEventStream: @unchecked Sendable {
    /// Rapid changes to one entry — an editor's burst of writes — arrive as
    /// one batch when they fall within this window.
    static let coalescingLatency: TimeInterval = 0.1

    /// FSEvents reports real paths, so the root is resolved once here and
    /// every event path is made relative to it.
    private let rootPath: String
    private let deliver: @Sendable ([FileEvent]) -> Void
    private let queue = DispatchQueue(label: "com.tacomancy.vitrine.library-watcher")
    private var stream: FSEventStreamRef?

    init(root: URL, deliver: @escaping @Sendable ([FileEvent]) -> Void) {
        rootPath = Self.realPath(of: root)
        self.deliver = deliver
    }

    /// The path with every symbolic link resolved, `/private/var` included —
    /// Foundation's own resolution strips that prefix, and FSEvents keeps it.
    private static func realPath(of url: URL) -> String {
        guard let resolved = realpath(url.path, nil) else { return url.path }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    func start() {
        var context = FSEventStreamContext()
        context.info = Unmanaged.passUnretained(self).toOpaque()
        let flags: FSEventStreamCreateFlags = UInt32(
            kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes
                | kFSEventStreamCreateFlagMarkSelf)
        guard
            let stream = FSEventStreamCreate(
                nil, Self.receive, &context, [rootPath] as CFArray,
                FSEventStreamEventId(kFSEventStreamEventIdSinceNow), Self.coalescingLatency,
                flags)
        else { return }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
    }

    /// Ends delivery. Once the block below has run no callback follows, and
    /// the stream, not this object, is what FSEvents still points at.
    func stop() {
        queue.async { [self] in
            guard let stream else { return }
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
        }
    }

    private static let receive: FSEventStreamCallback = {
        _, info, count, eventPaths, eventFlags, _ in
        guard let info,
            let paths = Unmanaged<CFArray>.fromOpaque(eventPaths).takeUnretainedValue() as? [String]
        else { return }
        let stream = Unmanaged<FileEventStream>.fromOpaque(info).takeUnretainedValue()
        let flags = UnsafeBufferPointer(start: eventFlags, count: count)
        stream.deliver(zip(paths, flags).compactMap(stream.event))
    }

    /// The event for one reported path, or nil when it lies outside the root.
    private func event(path: String, flags: FSEventStreamEventFlags) -> FileEvent? {
        guard path == rootPath || path.hasPrefix(rootPath + "/") else { return nil }
        let relativePath = String(path.dropFirst(rootPath.count).drop { $0 == "/" })
        func has(_ flag: Int) -> Bool { flags & FSEventStreamEventFlags(flag) != 0 }
        return FileEvent(
            path: relativePath,
            exists: FileManager.default.fileExists(atPath: path),
            isFolder: has(kFSEventStreamEventFlagItemIsDir),
            isSymbolicLink: has(kFSEventStreamEventFlagItemIsSymlink),
            isOwn: has(kFSEventStreamEventFlagOwnEvent),
            mustScanFolder: has(kFSEventStreamEventFlagMustScanSubDirs),
            wasRenamed: has(kFSEventStreamEventFlagItemRenamed),
            wasModified: has(kFSEventStreamEventFlagItemModified)
                || has(kFSEventStreamEventFlagItemInodeMetaMod))
    }
}
