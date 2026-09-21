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
 * `git rev-parse --short HEAD` and `git status --porcelain` as printed:
 * the short sha, `-dirty` appended when the tree has uncommitted changes.
 */
export function buildVersion(git: { sha: string; status: string }): string {
  const sha = git.sha.trim();
  return git.status.trim() === "" ? sha : `${sha}-dirty`;
}
