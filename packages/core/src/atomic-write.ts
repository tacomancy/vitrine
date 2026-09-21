import { randomBytes } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Write whole, then rename into place: a crash mid-write leaves a temp file
 * the vault scan ignores (it is a dot-entry), never half a file. Shared by
 * the capture (a new Question) and the vault-files writer (#121).
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
