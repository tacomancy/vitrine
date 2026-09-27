// The Host's one duty, kept pure so what it asks the dialog for can be
// tested without an Electron — the same reason `launch.ts` exists.

/** `dialog.showOpenDialog`, narrowed to the part of it the chooser uses. */
export type ShowOpenDialog = (options: {
  properties: Array<"openDirectory" | "createDirectory">;
}) => Promise<{ canceled: boolean; filePaths: string[] }>;

/**
 * Show the standard folder chooser and answer with the path, or null when
 * cancelled (core `Host`, `CONTEXT.md` § Host).
 *
 * `createDirectory` is what draws macOS's *New Folder* button in an open
 * panel, and it is the whole of story KEEP-10's "or create": without it a
 * first-time vault can only be made in Finder (#267). Dropping it breaks
 * nothing that looks broken — the chooser still opens, it just cannot make
 * a folder any more — so the properties are pinned by a test rather than
 * left to be noticed.
 */
export async function pickFolder(show: ShowOpenDialog): Promise<string | null> {
  const result = await show({
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
