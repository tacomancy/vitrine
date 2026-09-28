import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Write whole, then rename into place: a crash mid-write leaves a temp file
 * the vault scan ignores (it is a dot-entry), never half a file.
 */
export async function writeAtomically(
  path: string,
  content: string
): Promise<void> {
  const temp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temp, content, { flag: "wx" });
  try {
    await rename(temp, path);
  } catch (cause) {
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
