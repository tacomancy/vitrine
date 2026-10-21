import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { locate } from "./vault-files.js";

/**
 * The extensions a note can draw (spec #751): the ones the browser engine
 * decodes. A fixed list, not a Setting; anything else is refused by name
 * wherever a file is offered, and is never served as bytes here.
 */
export const VAULT_IMAGE_TYPES: Record<string, string> = {
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
