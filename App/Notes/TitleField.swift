import Library
import SwiftUI

/// The open note's title as a field (CONTEXT.md § Note): Return or focus
/// loss commits a rename in the note's folder; a refusal keeps the old
/// name and says why under the field; Escape reverts to it. Links
/// elsewhere are not rewritten, and nothing here says otherwise.
struct TitleField: View {
    let note: Note
    /// Renames the note given to the title given, throwing why it was
    /// refused. The note is passed because a title typed and then left by
    /// opening another note is committed for the note it was typed for.
    let rename: (Note, String) throws(LibraryError) -> Void
    let isFocused: FocusState<Bool>.Binding

    @State private var title: String
    @State private var refusal: LibraryError?

    /// Room for the brass ring around the text, taken back from the
    /// page padding so the title stays where the mockup puts it.
    private static let ringInset: CGFloat = 4
    private static let refusalSpacing: CGFloat = 6

    init(
        note: Note, rename: @escaping (Note, String) throws(LibraryError) -> Void,
        isFocused: FocusState<Bool>.Binding
    ) {
        self.note = note
        self.rename = rename
        self.isFocused = isFocused
        _title = State(initialValue: note.title)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Self.refusalSpacing) {
            TextField("Untitled", text: $title)
                .textFieldStyle(.plain)
                .font(.sans(.title, weight: .semibold))
                .foregroundStyle(Color(.fg))
                .focused(isFocused)
                .padding(.horizontal, Self.ringInset)
                .brassFocusRing(isFocused: isFocused.wrappedValue, cornerRadius: Radius.medium)
                .padding(.horizontal, -Self.ringInset)
                .onSubmit { commit(for: note) }
                .onExitCommand(perform: revert)
                .onChange(of: isFocused.wrappedValue) { _, isFocused in
                    if !isFocused { commit(for: note) }
                }
                .accessibilityLabel("Note title")
            if let refusal {
                Text(refusal.localizedDescription)
                    .font(.sans(.caption, weight: .regular))
                    .foregroundStyle(Color(.danger))
            }
        }
        // A different note, or this one renamed, brings its own title — a
        // title still being typed for the one left is committed for it
        // first, its refusal, if any, gone with it.
        .onChange(of: note) { old, note in
            if old.path != note.path { commit(for: old) }
            title = note.title
            refusal = nil
        }
    }

    private func commit(for note: Note) {
        let typed = title.trimmingCharacters(in: .whitespaces)
        guard typed != note.title else {
            title = note.title
            refusal = nil
            return
        }
        do {
            try rename(note, typed)
            refusal = nil
        } catch {
            refusal = error
        }
    }

    private func revert() {
        title = note.title
        refusal = nil
    }
}
