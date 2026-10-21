import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { VaultError } from "./errors.js";
import type { VaultIndex } from "./vault-index.js";
import { copyArtifact, locate } from "./vault-files.js";

/**
 * The extensions a note can draw (spec #751): the ones the browser engine
 * decodes. A fixed list, not a Setting; anything else is refused by name
 * wherever a file is offered, and is never served as bytes here.
 */
const VAULT_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * An image in the vault, for a note to draw (#752): its bytes with its type,
 * or null for everything the route will not say anything about — a path
 * outside the vault, a dot-entry, a symlink that leaves it (`locate`), a
 * non-image extension, a folder, a file that is not there. All of them are
 * the same 404, so the route is not a way to probe the disk.
 */
export async function vaultImageBytes(
  vaultPath: string,
  path: string
): Promise<Response | null> {
  const type =
    VAULT_IMAGE_TYPES[/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""];
  if (type === undefined) return null;
  try {
    const { absolute } = await locate(vaultPath, path, { anyFile: true });
    const found = await stat(absolute);
    if (!found.isFile()) return null;
    const body = Readable.toWeb(createReadStream(absolute)) as ReadableStream;
    return new Response(body, {
      headers: {
        "content-type": type,
        "content-length": String(found.size),
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return null;
  }
}

/**
 * Where a dropped image is stored: the vault root, a code constant and not a
 * Setting (spec #751; ADR 0025 decision 2). The embed written for it names
 * the file, never this folder, so renaming the folder later breaks nothing.
 */
const ASSETS = "assets";

/**
 * Drop an image on a note (#754; spec #751): the file copied into `assets/`,
 * the way an Experiment's Artifact is copied in (`copyArtifact`, ADR 0035) —
 * a taken name suffixed, the source only read — and recorded as the app's own
 * write so the watcher does not hand it back as an outside change (ADR 0013).
 * The note is not touched here: the editor writes the embed only once this has
 * answered, so a copy that fails leaves no link to a file that is not there.
 *
 * The extension is checked on the name as dropped, before anything is
 * created, so a refused file leaves no empty `assets/` behind.
 */
export async function attachImage(
  vaultPath: string,
  index: VaultIndex,
  source: string
): Promise<{ file: string; path: string }> {
  const extension = /\.([^./]+)$/.exec(basename(source))?.[1]?.toLowerCase();
  if (extension === undefined || VAULT_IMAGE_TYPES[extension] === undefined) {
    throw new VaultError(
      "refused",
      `${basename(source)} is not an image a note can draw: PNG, JPEG, GIF, WebP or SVG.`
    );
  }
  const copied = await copyArtifact(vaultPath, source, ASSETS);
  await index.ownFile(copied.path, copied.hash);
  return { file: copied.file, path: copied.path };
}
