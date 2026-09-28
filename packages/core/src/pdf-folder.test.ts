import { mkdir, realpath, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Host } from "./host.js";
import type { PdfFolder } from "./pdf-folder.js";
import { router } from "./router.js";
import { closeCores, core, tmp } from "./test-core.js";

// Settings' *Where the PDFs are* (#378; spec #363 stories 18–27): what
// `sources/pdf` is, what it resolves to, what it holds and when the last
// paper came — each read off a real arrangement on disk, by stat alone.

afterEach(closeCores);

/** A vault with `questions/` and whatever `arrange` makes of `sources/`. */
async function opened(
  arrange: (vault: string) => Promise<unknown>,
  host?: Host
) {
  const vault = await tmp("pdfs");
  await mkdir(join(vault, "questions"));
  await arrange(vault);
  const c = await core({ settleMs: 40, ...(host ? { host } : {}) });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

async function pdfFolder(c: Awaited<ReturnType<typeof core>>) {
  const reply = await c.query<PdfFolder>("vault.pdfFolder");
  expect(reply.error).toBeUndefined();
  return reply.result!.data;
}

/** A PDF of `bytes` bytes, last modified at `at`. */
async function pdf(folder: string, name: string, bytes: number, at: Date) {
  await writeFile(join(folder, name), Buffer.alloc(bytes, 0x25));
  await utimes(join(folder, name), at, at);
}

describe("a plain folder in the vault", () => {
  it("is itself, and holds nothing yet when fresh", async () => {
    const { vault, c } = await opened((v) =>
      mkdir(join(v, "sources/pdf"), { recursive: true })
    );
    expect(await pdfFolder(c)).toEqual({
      exists: true,
      link: null,
      resolves: {
        known: null,
        path: await realpath(join(vault, "sources/pdf")),
      },
      holds: { count: 0, bytes: 0 },
      lastArrived: null,
    });
  });

  it("counts its PDFs and their size by stat, and names the newest arrival", async () => {
    const { c } = await opened(async (v) => {
      const folder = join(v, "sources/pdf");
      await mkdir(join(folder, "older"), { recursive: true });
      await pdf(folder, "walker2017.pdf", 1000, new Date("2026-09-20T10:00Z"));
      await pdf(folder, "ramirez2024.PDF", 234, new Date("2026-09-27T16:40Z"));
      await pdf(
        join(folder, "older"),
        "lee2019.pdf",
        16,
        new Date("2026-01-01T00:00Z")
      );
      // Not papers: a note someone left, and the Finder's own dot file.
      await writeFile(join(folder, "README.txt"), "not a paper");
      await pdf(folder, ".hidden.pdf", 99, new Date("2026-09-28T00:00Z"));
    });
    const folder = await pdfFolder(c);
    expect(folder.exists && folder.holds).toEqual({ count: 3, bytes: 1250 });
    expect(folder.exists && folder.lastArrived).toEqual({
      at: "2026-09-27T16:40:00.000Z",
      name: "ramirez2024.PDF",
    });
  });
});

describe("a link out of the vault", () => {
  it("states the target as written and what it resolves to", async () => {
    const outside = await tmp("pdfs-elsewhere");
    await pdf(outside, "walker2017.pdf", 10, new Date("2026-09-27T16:40Z"));
    const { c } = await opened(async (v) => {
      await mkdir(join(v, "sources"));
      await symlink(outside, join(v, "sources/pdf"));
    });
    const folder = await pdfFolder(c);
    expect(folder).toMatchObject({
      exists: true,
      link: outside,
      resolves: { known: null },
      holds: { count: 1, bytes: 10 },
      lastArrived: { name: "walker2017.pdf" },
    });
    // `realpath`: on macOS the temp folder itself sits behind /var → /private/var.
    expect(folder.exists && folder.resolves?.path).toMatch(/pdfs-elsewhere-/);
  });

  it("names a folder under iCloud Drive's root as iCloud Drive", async () => {
    const home = await tmp("home");
    const papers = join(
      home,
      "Library/Mobile Documents/com~apple~CloudDocs/Research/Papers"
    );
    await mkdir(papers, { recursive: true });
    const { c } = await opened(async (v) => {
      await mkdir(join(v, "sources"));
      await symlink(papers, join(v, "sources/pdf"));
    });
    const folder = await pdfFolder(c);
    expect(folder.exists && folder.resolves?.known).toBe(
      "iCloud Drive › Research › Papers"
    );
  });

  it("names a folder under Dropbox's root as Dropbox", async () => {
    const home = await tmp("home");
    const papers = join(home, "Library/CloudStorage/Dropbox/Papers");
    await mkdir(papers, { recursive: true });
    const { c } = await opened(async (v) => {
      await mkdir(join(v, "sources"));
      await symlink(papers, join(v, "sources/pdf"));
    });
    const folder = await pdfFolder(c);
    expect(folder.exists && folder.resolves?.known).toBe("Dropbox › Papers");
  });

  it("names a sync root itself by the service alone", async () => {
    const home = await tmp("home");
    const root = join(home, "Library/CloudStorage/Dropbox-Personal");
    await mkdir(root, { recursive: true });
    const { c } = await opened(async (v) => {
      await mkdir(join(v, "sources"));
      await symlink(root, join(v, "sources/pdf"));
    });
    const folder = await pdfFolder(c);
    expect(folder.exists && folder.resolves?.known).toBe("Dropbox");
  });
});

describe("no sources/pdf at all", () => {
  it("says so, and is not a fault", async () => {
    const { c } = await opened(() => Promise.resolve());
    expect(await pdfFolder(c)).toEqual({ exists: false });
  });
});

describe("Reveal in Finder, for the PDF folder", () => {
  it("asks the host to reveal sources/pdf as it sits in the vault", async () => {
    const revealed: string[] = [];
    const { vault, c } = await opened(
      (v) => mkdir(join(v, "sources/pdf"), { recursive: true }),
      {
        pickFolder: () => Promise.resolve(null),
        reveal: (path) => {
          revealed.push(path);
        },
      }
    );
    const reply = await c.mutate("vault.reveal", { folder: "pdfs" });
    expect(reply.error).toBeUndefined();
    expect(revealed).toEqual([join(vault, "sources/pdf")]);
  });
});

// KEEP-11 (ADR 0025 decision 6): the app never moves a byte into or out of
// the PDF folder and never makes, re-points or removes its link. The absence
// of such a procedure is the promise, so it is what is tested: the one
// mutation that names the PDF folder at all is *Reveal in Finder*.
describe("no setter for the PDF folder", () => {
  it("has no mutation that could create, re-point, remove or copy into it", () => {
    const procedures = router._def.procedures as unknown as Record<
      string,
      { _def: { type: string } }
    >;
    const mutations = Object.entries(procedures)
      .filter(([, p]) => p._def.type === "mutation")
      .map(([path]) => path);
    expect(
      mutations.filter((path) => /pdf|symlink|sync|copy/i.test(path))
    ).toEqual([]);
    expect(
      mutations.filter((path) => path.startsWith("vault.")).sort()
    ).toEqual(["vault.open", "vault.pick", "vault.reveal", "vault.rewatch"]);
  });

  it("reveals only the two folders it names, never a path it is given", async () => {
    const { c } = await opened(() => Promise.resolve());
    const reply = await c.mutate("vault.reveal", { folder: "/etc" });
    expect(reply.error).toBeDefined();
  });
});
