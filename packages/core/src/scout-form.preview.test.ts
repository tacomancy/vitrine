import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// What the Scout form shows for chosen Tags (#688; spec #678): each Tag's Terms
// in use and the compiled arXiv query verbatim, read from the Lexicon.

const seeds = (edits: Record<string, string[]>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(edits).map(([tag, s]) => [tag, { seeds: s, excluded: [] }])
    )
  );

type Preview = {
  tags: Array<{ tag: string; terms: string[] }>;
  query: string | null;
};

async function opened(files: Record<string, string>) {
  const c = await core();
  const vault = await vaultWith(files);
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return c;
}

describe("scouts.previewTags", () => {
  it("lists each Tag's Terms and the query a run would ask, verbatim", async () => {
    const c = await opened({
      ".vitrine/lexicon.json": seeds({ ml: ["alpha"], bio: ["beta"] }),
    });

    const r = await c.query<Preview>("scouts.previewTags", {
      tags: ["ml", "bio"],
    });

    expect(r.result!.data).toEqual({
      tags: [
        { tag: "ml", terms: ["alpha"] },
        { tag: "bio", terms: ["beta"] },
      ],
      query: 'abs:"alpha" OR ti:"alpha" OR abs:"beta" OR ti:"beta"',
    });
  });

  it("shows a Tag with no Terms as empty and compiles the rest", async () => {
    const c = await opened({
      ".vitrine/lexicon.json": seeds({ ml: ["alpha"] }),
    });

    const r = await c.query<Preview>("scouts.previewTags", {
      tags: ["ml", "nothing"],
    });

    expect(r.result!.data.tags).toEqual([
      { tag: "ml", terms: ["alpha"] },
      { tag: "nothing", terms: [] },
    ]);
    expect(r.result!.data.query).toBe('abs:"alpha" OR ti:"alpha"');
  });

  it("has no query when nothing compiles", async () => {
    const c = await opened({});

    const r = await c.query<Preview>("scouts.previewTags", { tags: ["x"] });

    expect(r.result!.data.query).toBeNull();
  });
});
