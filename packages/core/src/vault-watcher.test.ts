import {
  mkdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { watch as fsWatch, type WatchListener } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Listing } from "./list.js";
import { closeCores, core, tmp, type CoreOptions } from "./test-core.js";
import type { VaultChanged } from "./vault-index.js";
import { FSEVENTS_LATENCY_MS } from "./vault-watcher.js";

// The watcher at the harness seam (spec #177 § Testing decisions): a real
// `fs.watch` on a temp vault, the settle window injected small, every wait on
// the event stream — never a sleep.
//
// "Small" is bounded from below as well as above (#268). Two tests here time
// something rather than merely waiting for it: the staggered-write Batch,
// whose stagger must land inside the window, and the watch-then-sweep race,
// which runs against the probe's bound. Both measure real elapsed time, and
// a `setTimeout(n)` fires *at least* n ms later — unboundedly later on a
// loaded CI runner. At a 40 ms window a 13 ms stagger overran it and the two
// writes arrived as two Batches. The window is now wide enough, and the
// stagger a small enough fraction of it, that ordinary jitter cannot close it
// early: 180 ms of headroom where there were 27 ms.

type Vault = { name: string; path: string };

afterEach(closeCores);

/**
 * Long enough that jitter between two staggered writes cannot close it, short
 * enough that seventeen tests still run in a few seconds. Not the production
 * 2 s (`vault-watcher.ts`), which no suite should wait out.
 */
const SETTLE_MS = 200;

/**
 * Above the probe's bound, never equal to it. At Vitest's 5 s default, the
 * watch-then-sweep test died before a slow probe reached the production 5 s
 * give-up, so a slow probe read as a broken test (#269). The harness now
 * bounds the probe at 1 s itself (`test-core.ts`), so a slow one fails here
 * by name rather than timing out; this stays wide so that elapsed-time
 * tests never race their own budget. The give-up itself is
 * `vault-watcher.health.test.ts`'s (#272).
 */
const TIMING_TIMEOUT_MS = 20_000;

function questionFile(text: string, captured = "2026-09-20T09:00:00Z") {
  return `---\nkind: question\nquestion: ${text}\nstatus: open\ncaptured: ${captured}\ncontext: other\n---\n`;
}

/** A vault opened, indexed, and subscribed to, ready for an external change. */
async function watching(
  files: Record<string, string> = {},
  opts: CoreOptions = {}
) {
  const vault = await tmp("watched");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(vault, name, ".."), { recursive: true });
    await writeFile(join(vault, name), content);
  }
  const c = await core({ settleMs: SETTLE_MS, ...opts });
  const reply = await c.mutate<Vault>("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  const stream = await c.events();
  const questions = async () => {
    const listing = await c.query<Listing>("questions.list");
    expect(listing.error).toBeUndefined();
    return (listing.result?.data as Listing).questions.map((q) => q.question);
  };
  return { vault, c, stream, questions };
}

describe("an edit made outside the app reaches the Inbox", () => {
  it("a Question file added with fs is listed after the vaultChanged that names it", async () => {
    const { vault, stream, questions } = await watching();
    expect(await questions()).toEqual([]);

    await mkdir(join(vault, "questions"));
    await writeFile(
      join(vault, "questions", "From Obsidian.md"),
      questionFile("From Obsidian")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/From Obsidian.md"],
      removed: [],
      renamed: [],
    });
    expect(await questions()).toEqual(["From Obsidian"]);
    stream.close();
  });

  it("an edit to a Question's text is in its row after the vaultChanged", async () => {
    const { vault, stream, questions } = await watching({
      "questions/Q.md": questionFile("Before"),
    });
    expect(await questions()).toEqual(["Before"]);

    await writeFile(join(vault, "questions", "Q.md"), questionFile("After"));
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/Q.md"],
      removed: [],
      renamed: [],
    });
    expect(await questions()).toEqual(["After"]);
    stream.close();
  });

  it("a deleted Question leaves the list after a vaultChanged naming it removed", async () => {
    const { vault, stream, questions } = await watching({
      "questions/Q.md": questionFile("Going"),
      "questions/Staying.md": questionFile("Staying", "2026-09-19T09:00:00Z"),
    });
    expect(await questions()).toEqual(["Going", "Staying"]);

    await rm(join(vault, "questions", "Q.md"));
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: [],
      removed: ["questions/Q.md"],
      renamed: [],
    });
    expect(await questions()).toEqual(["Staying"]);
    stream.close();
  });
});

describe("what settles together is one Batch, and only a real change is one", () => {
  it("a multi-step save — temp file, rename over, a second write — is one vaultChanged and never a Partial row", async () => {
    // A listener that reads the list on every event, as the renderer will:
    // what it sees is what the Inbox would have shown.
    const seen: Array<{
      event: VaultChanged;
      partial: string[];
      questions: string[];
    }> = [];
    let listed: () => void = () => undefined;
    const recorded = new Promise<void>((resolve) => (listed = resolve));
    const c0 = { c: null as Awaited<ReturnType<typeof core>> | null };
    const { vault, c, stream } = await watching(
      {},
      {
        onVaultChanged: async (event) => {
          if (c0.c === null) return;
          const reply = await c0.c.query<Listing>("questions.list");
          const listing = reply.result?.data as Listing;
          seen.push({
            event,
            partial: listing.partial.map((p) => p.name),
            questions: listing.questions.map((q) => q.question),
          });
          listed();
        },
      }
    );
    c0.c = c;

    const folder = join(vault, "questions");
    await mkdir(folder);
    // Obsidian's shape of a save, all inside one settle window: a partial
    // file first, a temp file renamed over it, then one more write.
    await writeFile(join(folder, "Q.md"), "---\nkind: question\n---\n");
    await writeFile(
      join(folder, "Q.md.tmp"),
      questionFile("Whole, first pass")
    );
    await rename(join(folder, "Q.md.tmp"), join(folder, "Q.md"));
    await writeFile(join(folder, "Q.md"), questionFile("Whole"));

    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/Q.md"],
      removed: [],
      renamed: [],
    });
    // The listener that read the list on the event saw the whole file, and
    // the vanished temp file was never a row.
    await recorded;
    expect(seen).toEqual([
      {
        event: {
          type: "vaultChanged",
          changed: ["questions/Q.md"],
          removed: [],
          renamed: [],
        },
        partial: [],
        questions: ["Whole"],
      },
    ]);
    stream.close();
  });

  it(
    "two writes a moment apart, both inside the settle window, are one Batch",
    async () => {
      const { vault, stream } = await watching();
      await mkdir(join(vault, "questions"));
      // Staggered as inotify delivers a rename's two events (FSEvents
      // coalesces them): the second lands after the first's window has begun
      // but before it has closed. The stagger is the input, not a wait.
      await writeFile(join(vault, "questions", "A.md"), questionFile("A"));
      await new Promise((r) => setTimeout(r, SETTLE_MS / 10));
      await writeFile(join(vault, "questions", "B.md"), questionFile("B"));
      expect(await stream.next("vaultChanged")).toEqual({
        type: "vaultChanged",
        changed: ["questions/A.md", "questions/B.md"],
        removed: [],
        renamed: [],
      });
      stream.close();
    },
    TIMING_TIMEOUT_MS
  );

  it("questions.capture raises one vaultChanged; the watcher's own event for the file raises no second", async () => {
    const { vault, c, stream, questions } = await watching();
    const reply = await c.mutate<{ path: string }>("questions.capture", {
      text: "Captured here",
      provenance: { context: "other" },
    });
    expect(reply.error).toBeUndefined();
    expect((await stream.next("vaultChanged")).changed).toEqual([
      "questions/Captured here.md",
    ]);

    // The proof of absence: the next event is for a later, unrelated write,
    // and names it alone — a second event for the capture would have come
    // first or been batched beside it.
    await writeFile(
      join(vault, "questions", "Sentinel.md"),
      questionFile("Sentinel")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/Sentinel.md"],
      removed: [],
      renamed: [],
    });
    expect(await questions()).toEqual(["Captured here", "Sentinel"]);
    stream.close();
  });

  it("a byte-identical rewrite — a touch, a copy over itself — raises nothing", async () => {
    const { vault, stream } = await watching({
      "questions/Q.md": questionFile("Same"),
    });
    const later = new Date(Date.now() + 60_000);
    await utimes(join(vault, "questions", "Q.md"), later, later);
    await writeFile(join(vault, "questions", "Q.md"), questionFile("Same"));

    await writeFile(
      join(vault, "questions", "Sentinel.md"),
      questionFile("Sentinel")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/Sentinel.md"],
      removed: [],
      renamed: [],
    });
    stream.close();
  });

  it("a file written inside .obsidian/ or .vitrine/ raises nothing", async () => {
    const { vault, stream } = await watching({
      ".obsidian/app.json": "{}",
    });
    await writeFile(join(vault, ".obsidian", "workspace.json"), "{}");
    await writeFile(join(vault, ".vitrine", "scratch.json"), "{}");

    await mkdir(join(vault, "questions"));
    await writeFile(
      join(vault, "questions", "Sentinel.md"),
      questionFile("Sentinel")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/Sentinel.md"],
      removed: [],
      renamed: [],
    });
    stream.close();
  });
});

describe("a folder is one event", () => {
  it("a folder moved out of the vault in Finder removes every row under it, in one vaultChanged", async () => {
    const { vault, stream, questions } = await watching({
      "old/A.md": questionFile("A", "2026-09-01T09:00:00Z"),
      "old/deeper/B.md": questionFile("B", "2026-09-02T09:00:00Z"),
      "Keep.md": questionFile("Keep", "2026-09-03T09:00:00Z"),
    });
    expect(await questions()).toEqual(["Keep", "B", "A"]);

    // Finder's delete and its drag out are both one rename of the folder:
    // one event, for the folder alone.
    await rename(join(vault, "old"), join(await tmp("trash"), "old"));
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: [],
      removed: ["old/A.md", "old/deeper/B.md"],
      renamed: [],
    });
    expect(await questions()).toEqual(["Keep"]);
    stream.close();
  });

  it("a folder moved into the vault indexes every file under it", async () => {
    const { vault, stream, questions } = await watching();
    const outside = await tmp("moved-in");
    await mkdir(join(outside, "nested"));
    await writeFile(
      join(outside, "C.md"),
      questionFile("C", "2026-09-01T09:00:00Z")
    );
    await writeFile(
      join(outside, "nested", "D.md"),
      questionFile("D", "2026-09-02T09:00:00Z")
    );

    await rename(outside, join(vault, "arrived"));
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["arrived/C.md", "arrived/nested/D.md"],
      removed: [],
      renamed: [],
    });
    expect(await questions()).toEqual(["D", "C"]);
    stream.close();
  });

  it("a file replaced by a differently named one in the same batch is one event with both", async () => {
    const { vault, stream, questions } = await watching({
      "questions/Old.md": questionFile("Old"),
    });
    await rm(join(vault, "questions", "Old.md"));
    await writeFile(
      join(vault, "questions", "New.md"),
      questionFile("New, not Old")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/New.md"],
      removed: ["questions/Old.md"],
      renamed: [],
    });
    expect(await questions()).toEqual(["New, not Old"]);
    stream.close();
  });
});

describe("a rename is one event, and the row follows it", () => {
  it("fs.rename of a Question inside the settle window is one vaultChanged with renamed, nothing removed, and the row under the new path", async () => {
    const { vault, c, stream } = await watching({
      "questions/Q.md": questionFile("Moving"),
    });
    await rename(
      join(vault, "questions", "Q.md"),
      join(vault, "questions", "Moved.md")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: [],
      removed: [],
      renamed: [{ from: "questions/Q.md", to: "questions/Moved.md" }],
    });
    const listing = await c.query<Listing>("questions.list");
    expect(
      (listing.result?.data as Listing).questions.map((q) => [
        q.question,
        q.path,
      ])
    ).toEqual([["Moving", join(vault, "questions", "Moved.md")]]);
    stream.close();
  });

  it("a rename that also edits the file is removed plus changed, by design", async () => {
    const { vault, stream, questions } = await watching({
      "questions/Q.md": questionFile("Before"),
    });
    await rename(
      join(vault, "questions", "Q.md"),
      join(vault, "questions", "Moved.md")
    );
    await writeFile(
      join(vault, "questions", "Moved.md"),
      questionFile("Moved and edited")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/Moved.md"],
      removed: ["questions/Q.md"],
      renamed: [],
    });
    expect(await questions()).toEqual(["Moved and edited"]);
    stream.close();
  });

  it("a plain Note and a non-Markdown file pair the same way", async () => {
    const { vault, stream } = await watching({
      "notes/Loose thought.md": "# A note\n\nNo kind, no frontmatter.\n",
      "assets/plot.png": "\x89PNG not really\n",
    });
    await rename(
      join(vault, "notes", "Loose thought.md"),
      join(vault, "notes", "Kept thought.md")
    );
    await rename(
      join(vault, "assets", "plot.png"),
      join(vault, "assets", "figure-1.png")
    );
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: [],
      removed: [],
      renamed: [
        { from: "assets/plot.png", to: "assets/figure-1.png" },
        { from: "notes/Loose thought.md", to: "notes/Kept thought.md" },
      ],
    });
    stream.close();
  });

  it("two files swapped by rename in one batch each find their new path", async () => {
    const { vault, c, stream } = await watching({
      "questions/A.md": questionFile("Was A", "2026-09-01T09:00:00Z"),
      "questions/B.md": questionFile("Was B, longer", "2026-09-02T09:00:00Z"),
    });
    const a = join(vault, "questions", "A.md");
    const b = join(vault, "questions", "B.md");
    const aside = join(vault, "questions", "swap.tmp");
    await rename(a, aside);
    await rename(b, a);
    await rename(aside, b);
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: [],
      removed: [],
      renamed: [
        { from: "questions/B.md", to: "questions/A.md" },
        { from: "questions/A.md", to: "questions/B.md" },
      ],
    });
    const listing = await c.query<Listing>("questions.list");
    expect(
      (listing.result?.data as Listing).questions.map((q) => [
        q.question,
        q.path,
      ])
    ).toEqual([
      ["Was B, longer", a],
      ["Was A", b],
    ]);
    stream.close();
  });
});

/**
 * The real `fs.watch`, except that an event naming one of `held` reaches the
 * listener `FSEVENTS_LATENCY_MS` late — what FSEvents does to the second of
 * two changes a millisecond apart whenever `fseventsd` is busy: the first goes
 * out at once, the second waits out the stream's latency in the next callback.
 * Deterministic here where, on a real machine, it depends on what else is
 * writing to disk.
 */
function deferring(held: string[]) {
  const watch: typeof fsWatch = ((
    folder: string,
    options: { recursive: boolean },
    listener: WatchListener<string>
  ) =>
    fsWatch(folder, options, (kind, filename) => {
      if (filename !== null && held.includes(filename)) {
        setTimeout(() => listener(kind, filename), FSEVENTS_LATENCY_MS);
      } else {
        listener(kind, filename);
      }
    })) as typeof fsWatch;
  return watch;
}

describe("two changes a moment apart are one Batch however FSEvents splits them", () => {
  it("a second rename delivered one FSEvents latency after the first shares its vaultChanged, even at a settle window injected shorter than that latency", async () => {
    // 40 ms is what most suites inject; below the latency, the first rename
    // settled and closed its Batch before the second was heard (#393's
    // flaking rename-pairing test in `resolution.test.ts`).
    const { vault, stream } = await watching(
      { "notes/A.md": "a\n", "notes/B.md": "b\n" },
      { settleMs: 40, watch: deferring(["notes/B.md", "notes/D.md"]) }
    );
    await rename(join(vault, "notes", "A.md"), join(vault, "notes", "C.md"));
    await rename(join(vault, "notes", "B.md"), join(vault, "notes", "D.md"));
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: [],
      removed: [],
      renamed: [
        { from: "notes/A.md", to: "notes/C.md" },
        { from: "notes/B.md", to: "notes/D.md" },
      ],
    });
    stream.close();
  });

  it("a rename whose new name is delivered one FSEvents latency after its old one still pairs, at the same injected window", async () => {
    const { vault, stream } = await watching(
      { "notes/A.md": "a\n" },
      { settleMs: 40, watch: deferring(["notes/C.md"]) }
    );
    await rename(join(vault, "notes", "A.md"), join(vault, "notes", "C.md"));
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: [],
      removed: [],
      renamed: [{ from: "notes/A.md", to: "notes/C.md" }],
    });
    stream.close();
  });
});

describe("the two watches and the sweep", () => {
  it("a PDF written through a symlinked sources/pdf outside the root is a row at sources/pdf/<name>", async () => {
    const outside = await tmp("pdf-folder");
    const vault = await tmp("linked");
    await mkdir(join(vault, "sources"));
    await symlink(outside, join(vault, "sources", "pdf"));
    const c = await core({ settleMs: SETTLE_MS });
    await c.mutate<Vault>("vault.open", { path: vault });
    await c.indexed();
    const stream = await c.events();

    await writeFile(join(outside, "klinzing2019.pdf"), "%PDF-1.4\n");
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["sources/pdf/klinzing2019.pdf"],
      removed: [],
      renamed: [],
    });
    stream.close();
  });

  it(
    "a file added between vault open and the sweep's end is indexed: watch, then sweep",
    async () => {
      const vault = await tmp("racing");
      await mkdir(join(vault, "questions"));
      for (let n = 1; n <= 3; n++) {
        await writeFile(
          join(vault, "questions", `Q ${n}.md`),
          questionFile(`Q ${n}`, `2026-01-0${n}T09:00:00Z`)
        );
      }
      // The first status event is raised once the sweep has walked the vault
      // and before it reads anything: a file written now is one the walk did
      // not see, so only a watcher already running can find it. Written from
      // the callback, so the timing is pinned rather than hoped for.
      let written = false;
      const c = await core({
        settleMs: SETTLE_MS,
        onVaultStatus: async () => {
          if (written) return;
          written = true;
          await writeFile(
            join(vault, "questions", "Late.md"),
            questionFile("Late")
          );
        },
      });
      const reply = await c.mutate<Vault>("vault.open", { path: vault });
      expect(reply.error).toBeUndefined();
      await c.indexed();
      expect(written).toBe(true);

      const stream = await c.events();
      if (!c.changes.some((e) => e.changed.includes("questions/Late.md"))) {
        // Its batch is still settling: wait on the stream, not on a timer.
        for (;;) {
          const event = await stream.next("vaultChanged");
          if (event.changed.includes("questions/Late.md")) break;
        }
      }
      stream.close();
      const listing = await c.query<Listing>("questions.list");
      expect(
        (listing.result?.data as Listing).questions.map((q) => q.question)
      ).toEqual(["Late", "Q 3", "Q 2", "Q 1"]);
    },
    TIMING_TIMEOUT_MS
  );
});
