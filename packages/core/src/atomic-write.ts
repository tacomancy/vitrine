import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Write whole, then rename into place: the target is only ever a whole file.
 * A write that fails — a full disk, an I/O error — removes its temp file, as
 * far as the disk allows. A crash leaves one, which the vault scan ignores (it
 * is a dot-entry).
 */
export async function writeAtomically(
  path: string,
  content: string | Uint8Array
): Promise<void> {
  const temp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, content, { flag: "wx" });
    await rename(temp, path);
  } catch (cause) {
    // Either step can fail with the temp file on the disk: a full disk fails
    // the write after the file is made, leaving what fit in it (#540), and
    // nothing else in the app removes a temp file. Whatever the unlink says is
    // not the reason: when the write was refused before there was a file it
    // finds nothing, and that ENOENT must not stand in for the cause.
    await unlink(temp).catch(() => undefined);
    throw cause;
  }
}

/**
 * `writeAtomically` for bytes the app did not compose: the source is
 * streamed into the temp file — an Artifact the user chose to store may be
 * far larger than memory should hold — and hashed on the way through, so
 * the index can record the copy as the app's own without reading it again.
 * Answers with the SHA-256 of what was written. The source is only read.
 */
export async function copyAtomically(
  source: string,
  path: string
): Promise<string> {
  const temp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  const hash = createHash("sha256");
  try {
    await pipeline(
      createReadStream(source),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(temp, { flags: "wx" })
    );
    await rename(temp, path);
  } catch (cause) {
    await unlink(temp).catch(() => undefined);
    throw cause;
  }
  return hash.digest("hex");
}
