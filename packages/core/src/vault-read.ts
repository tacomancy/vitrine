import { readFile, stat } from "node:fs/promises";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import { fileChoices, locate, sha256 } from "./vault-files.js";

/** What the Vault editor needs to open a file and to save it back (#690). */
export type FileText = {
  /** What the editor holds: no BOM, LF throughout, the trailing newline (or its absence) as the file has it. */
  text: string;
  /** SHA-256 of the *bytes*, not of `text`: it is the `basedOn` of the save, which compares against the disk. */
  hash: string;
  /** The line ending the write restores around the editor's LF text. */
  eol: "lf" | "crlf";
  /** Whether the write restores a byte-order mark. */
  bom: boolean;
  /** Milliseconds since the epoch, for the header's *edited* time. */
  mtime: number;
};

/**
 * `vault.read`: one Markdown file as the editor holds it. Reading never
 * writes — opening a file in the Vault must not be able to change a byte, so
 * the CRLF and BOM the editor cannot hold are handed over as facts about the
 * file rather than normalised on disk. A path outside the vault or a file
 * that is not Markdown is the vault's own refusal (`locate`); a file that
 * will not read is said without its path (ADR 0028).
 */
export async function readFileText(
  vaultPath: string,
  path: string
): Promise<FileText> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  try {
    const [bytes, info] = await Promise.all([
      readFile(absolute),
      stat(absolute),
    ]);
    const { text, file } = fileChoices(bytes.toString("utf8"));
    return {
      text: file.eol === "crlf" ? text.replace(/\r\n/g, "\n") : text,
      hash: sha256(bytes),
      eol: file.eol,
      bom: file.bom,
      mtime: Math.round(info.mtimeMs),
    };
  } catch (cause) {
    throw new VaultError(
      "unreadable",
      `Couldn't read ${relativePath}: ${errorMessageWithoutPath(cause)}`
    );
  }
}
