// The shell's launch-time choices, kept pure so they can be tested without
// an Electron (docs/architecture.md § Build and dev, § Packaging). The only
// `app.isPackaged` branches in the shell live here.
import { join } from "node:path";

/**
 * Where the core's built entry is. Packaged, the core is staged as a whole
 * package under `Contents/Resources/core`; otherwise it is the workspace
 * sibling of the shell, reached from the shell's own `out/main`.
 */
export function coreEntry(options: {
  isPackaged: boolean;
  resourcesPath: string;
  mainDir: string;
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, "core", "dist", "main.js")
    : join(options.mainDir, "../../../core/dist/main.js");
}

/**
 * The core's state folder. Anything that is not the installed bundle gets
 * `Vitrine (dev)`, so a development build beside the installed app never
 * opens the same vault (two instances would be two writers to one index).
 * An explicit `VITRINE_APP_SUPPORT_DIR` wins, which is what run-hidden's
 * temp folder relies on; an empty one counts as unset so the core is never
 * handed "" as a path.
 */
export function stateFolder(options: {
  explicit: string | undefined;
  isPackaged: boolean;
  appData: string;
}): string {
  if (options.explicit) return options.explicit;
  return join(
    options.appData,
    options.isPackaged ? "Vitrine" : "Vitrine (dev)"
  );
}

/**
 * The build identity the packager passes as `buildVersion`, from
 * `git describe --tags --always` and `git status --porcelain` as printed:
 * the describe string, `-dirty` appended when the tree has uncommitted
 * changes. `beat-2-39-g5f08a59` places the build against the last beat that
 * shipped, which a bare sha cannot; `--always` means a clone with no tags
 * fetched still describes itself, as that sha, rather than failing the build.
 *
 * `-dirty` comes from `status`, never `describe --dirty`: describe ignores
 * untracked files and status does not, and one suffix wants one source.
 */
export function buildVersion(git: {
  described: string;
  status: string;
}): string {
  const described = git.described.trim();
  return git.status.trim() === "" ? described : `${described}-dirty`;
}

/**
 * The name a linked Artifact records as the machine it was linked on (ADR
 * 0035 decision 5): the Mac's computer name — *Studio Mac*, what Sharing
 * settings shows and what the researcher calls it — rather than the host
 * name, which is a DNS label the user never chose. Electron does not expose
 * it, so `scutil --get ComputerName` is asked; if that fails or says
 * nothing, the host name stands in, since a line must name some machine.
 */
export function machineName(options: {
  computerName: () => string;
  hostname: string;
}): string {
  try {
    const name = options.computerName().trim();
    if (name !== "") return name;
  } catch {
    // Falls through to the host name.
  }
  return options.hostname;
}

/**
 * The name a highlight's `/T` carries (#441), so Preview shows the person's
 * name rather than the login's short name. Node cannot read the account's
 * full name, so the shell asks `id -F`. Unreadable or blank is `undefined`,
 * not a guess: the core then keeps its own default, and a highlight is never
 * refused over a name.
 */
export function authorName(options: {
  fullName: () => string;
}): string | undefined {
  try {
    const name = options.fullName().trim();
    if (name !== "") return name;
  } catch {
    // Falls through to the core's default.
  }
  return undefined;
}
