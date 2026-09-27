import { mkdtemp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { errorMessageWithoutPath } from "./errors.js";

/**
 * The one promise this function makes is that no absolute path leaves it
 * (#277, #285): a reason is read in the window, in a screenshot, and in a
 * bug report pasted out of one, and the machine's filesystem layout is never
 * something a reader can use. Every case below is a way that promise could
 * be broken, so the cases nothing in `fs` can throw are here too.
 */
describe("errorMessageWithoutPath", () => {
  // The apostrophe is what a strip has to survive: the real vault is
  // `Wan Shi Tong's Library`, and a Question is named after the question.
  let vault: string;
  beforeAll(async () => {
    vault = join(await mkdtemp(join(tmpdir(), "vitrine-errors-")), "Tong's");
    await mkdir(join(vault, "folder"), { recursive: true });
    await mkdir(join(vault, "full"), { recursive: true });
    await writeFile(join(vault, "full", "keep.md"), "x");
    await writeFile(join(vault, "file.md"), "x");
  });

  const thrown = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error("expected a failure");
  };

  it("keeps the cause of a real errno and cuts the path off, apostrophe and all", async () => {
    const missing = await thrown(() => readFile(join(vault, "nope.md")));
    expect(errorMessageWithoutPath(missing)).toBe(
      "ENOENT: no such file or directory"
    );

    // A path *through* a file rather than a folder.
    const through = await thrown(() =>
      readFile(join(vault, "file.md", "inner.md"))
    );
    expect(errorMessageWithoutPath(through)).toBe("ENOTDIR: not a directory");
  });

  it("loses the second path with the first when the call names two", async () => {
    // The write protocol renames on every commit, so a two-path errno is
    // one this has to hold for.
    const clash = await thrown(() =>
      rename(join(vault, "folder"), join(vault, "full"))
    );

    expect(errorMessageWithoutPath(clash)).toBe(
      "ENOTEMPTY: directory not empty"
    );
  });

  it("leaves a message alone when the error names no file", async () => {
    const directory = await thrown(() => readFile(join(vault, "folder")));

    // EISDIR carries no `path`, so there is nothing to cut.
    expect(errorMessageWithoutPath(directory)).toBe(
      "EISDIR: illegal operation on a directory, read"
    );
  });

  // Nothing in `fs` throws these, which is exactly why they are pinned here:
  // the function is shared, and a caller that re-throws or wraps an errno
  // keeps `path` while losing the shape the cut reads.
  it("still takes the path out when the message was not stated Node's way", () => {
    const wrapped = Object.assign(
      new Error(`EACCES: denied, open '${vault}'`),
      {
        code: "EACCES",
        path: vault,
        // `syscall` lost in the wrapping: the cut cannot find what it looks for.
      }
    );

    const reason = errorMessageWithoutPath(wrapped);
    expect(reason).not.toContain(vault);
    expect(reason).toBe("EACCES: denied, open '…'");
  });

  it("takes whatever a catch binds without throwing itself", () => {
    expect(errorMessageWithoutPath(null)).toBe("null");
    expect(errorMessageWithoutPath(undefined)).toBe("undefined");
    expect(errorMessageWithoutPath("a string")).toBe("a string");
    expect(errorMessageWithoutPath(new Error("plain failure"))).toBe(
      "plain failure"
    );
  });
});
