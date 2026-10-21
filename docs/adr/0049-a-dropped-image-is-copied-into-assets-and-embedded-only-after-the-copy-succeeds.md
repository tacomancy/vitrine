# 0049: A dropped image is copied into `assets/` and embedded only after the copy succeeds

**Status:** Accepted

Spec #751, ticket #754. Dropping an image file on a note in the Vault editor stores it in the vault and writes the embed. This reopens ADR 0008's closed set of writes the way ADR 0035 did, but by reusing the operation rather than adding one.

## Decisions

1. **The copy is `copyArtifact`, aimed at `assets/`.** Same temp file and rename, same module-scope queue (two drops of one name cannot both find it free), same ` (2)`, ` (3)` suffix, same stripping of Obsidian's forbidden set and a leading dot, source only read. It is a second caller of the eighth write, not a ninth write. Considered: a separate copy function — it would restate the queue, the exact thing that must live in one place.
2. **`assets/` is at the vault root, created by the first drop.** A code constant, not a Setting (ADR 0025 decision 2). Obsidian's own attachment default is a folder beside `notes/`, so a vault shared with it keeps one place. The embed names the file, not the folder, so renaming the folder later breaks nothing (ADR 0036).
3. **Images only, checked before anything is created.** PNG, JPEG, GIF, WebP, SVG — the extensions the bytes route serves. Anything else is refused by name (ADR 0033), and a refusal leaves no empty `assets/`.
4. **Copy first, embed after.** The editor writes `![[name]]` only for a name the core answered with, so a failed copy leaves the note untouched and no link to a file that is not there. The copy is recorded with `ownFile`, as the app's own write (ADR 0013).
5. **The embed is one transaction at the drop position, on a line of its own.** The position is carried through every change made while the copy was out. The live preview draws only a whole-line embed, so a drop mid-line splits the line. Several files give several embeds, in the order dropped, one undo.
6. **Undo removes the text and leaves the file.** Nothing the app copies in is deleted (ADR 0035 decision 2). This is the editor's first undo history; text pushed in from disk is kept out of it, so ⌘Z never takes back what the disk said.

## Considered options

- **`notes/assets/`** — keeps the vault root to the Kind folders. Rejected: Obsidian's own attachment default is a folder beside `notes/`, so a vault shared with it keeps one place for images, and the embed names the file, not the folder, so either location resolves (ADR 0036).
- **A ninth write operation, separate from `copyArtifact`** — the spec's first framing. Rejected for decision 1: a second queue is a second place to forget it. The closed set in `docs/architecture.md` stays at eight kinds, with a second caller named.
