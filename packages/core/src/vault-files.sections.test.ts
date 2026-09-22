import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Outline } from "markdown";
import {
  nextBlockId,
  readOutline,
  write,
  type Operation,
  type WriteResult,
} from "./vault-files.js";
import {
  basedOn,
  bytes,
  corpusCopy as copyOf,
  refused,
  sha256,
  vaultWith,
  written,
} from "./test-core.js";

// The four section operations at the module seam (#122): every assertion is
// on the bytes of the file afterwards or the result a caller sees. "Nothing
// outside the target changed" is asserted by comparing the untouched prefix
// and suffix of the original, never by counting diff hunks.

// The write's own locating is right, so the only way to see verification
// catch a wrong splice is to make the locator wrong once: `tamper` rewrites
// the next outline the writer asks for, then steps aside. It relies on the
// write parsing for frontmatter only when there is a frontmatter operation,
// so the first parse it makes is the section operation's.
const fault = vi.hoisted(() => ({
  tamper: null as ((outline: Outline) => void) | null,
}));
vi.mock("markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("markdown")>();
  return {
    ...actual,
    outline: (source: string) => {
      const result = actual.outline(source);
      if (fault.tamper) {
        fault.tamper(result);
        fault.tamper = null;
      }
      return result;
    },
  };
});

/** Apply one operation to a file and return the bytes afterwards. */
async function applied(
  vault: string,
  path: string,
  ...operations: Operation[]
): Promise<{ after: string; result: WriteResult }> {
  const result = await write(vault, path, {
    operations,
    basedOn: await basedOn(vault, path),
  });
  return { after: await bytes(join(vault, path)), result };
}

/**
 * The bytes outside one target range are identical before and after: the
 * prefix up to the range's start and the suffix from its end.
 */
function expectUntouchedAround(
  original: string,
  after: string,
  range: { start: number; end: number }
) {
  expect(after.startsWith(original.slice(0, range.start))).toBe(true);
  expect(after.endsWith(original.slice(range.end))).toBe(true);
}

const replaceSection = (name: string, body: string): Operation => ({
  op: "replaceSection",
  name,
  body,
});

describe("replaceSection", () => {
  it("rewrites the body from the line after the heading to the line before the next heading of level ≤ 2, keeping the heading and the blank lines around it", async () => {
    const original = [
      "---",
      "kind: source",
      "---",
      "My notes.",
      "",
      "## Annotations",
      "",
      '- p.1 · "old quote" ^h1',
      "  old note",
      "",
      "## After",
      "",
      "Still mine.",
      "",
    ].join("\n");
    const vault = await vaultWith({ "s.md": original });
    const read = await readOutline(vault, "s.md");
    if (!read.readable) throw new Error(read.reason);
    const section = read.outline.headings.find(
      (h) => h.text === "Annotations"
    )!;

    const { after, result } = await applied(
      vault,
      "s.md",
      replaceSection(
        "Annotations",
        '- p.1 · "new quote" ^h1\n  new note\n- p.2 · "second" ^h2\n'
      )
    );

    written(result);
    expect(after).toBe(
      [
        "---",
        "kind: source",
        "---",
        "My notes.",
        "",
        "## Annotations",
        "",
        '- p.1 · "new quote" ^h1',
        "  new note",
        '- p.2 · "second" ^h2',
        "",
        "## After",
        "",
        "Still mine.",
        "",
      ].join("\n")
    );
    expectUntouchedAround(original, after, section.body);
  });
});

describe("owned sections: absent, renamed, duplicated", () => {
  it("an absent section is appended at the end of the file after one blank line, never at a canonical position; the trailing-newline choice survives (Sleep and consolidation.md has none)", async () => {
    const { vault, original } = await copyOf("Sleep and consolidation.md");
    expect(original.endsWith("\n")).toBe(false);

    const { after, result } = await applied(
      vault,
      "Sleep and consolidation.md",
      replaceSection(
        "Position history",
        "- 2026-09-21T10:00:00+02:00 · claim\n"
      )
    );

    written(result);
    expect(after).toBe(
      original +
        "\n\n## Position history\n\n- 2026-09-21T10:00:00+02:00 · claim"
    );
  });

  it("appends after exactly one blank line whether the file ends with none, one, or already a blank line", async () => {
    const vault = await vaultWith({
      "none.md": "---\nkind: hypothesis\n---\n## Claim\n\nText",
      "one.md": "---\nkind: hypothesis\n---\n## Claim\n\nText\n",
      "blank.md": "---\nkind: hypothesis\n---\n## Claim\n\nText\n\n",
    });
    const entry = "- 2026-09-21T10:00:00+02:00 · claim";
    expect(
      (
        await applied(
          vault,
          "none.md",
          replaceSection("Position history", entry)
        )
      ).after
    ).toBe(
      "---\nkind: hypothesis\n---\n## Claim\n\nText\n\n## Position history\n\n- 2026-09-21T10:00:00+02:00 · claim"
    );
    expect(
      (
        await applied(
          vault,
          "one.md",
          replaceSection("Position history", entry)
        )
      ).after
    ).toBe(
      "---\nkind: hypothesis\n---\n## Claim\n\nText\n\n## Position history\n\n- 2026-09-21T10:00:00+02:00 · claim\n"
    );
    expect(
      (
        await applied(
          vault,
          "blank.md",
          replaceSection("Position history", entry)
        )
      ).after
    ).toBe(
      "---\nkind: hypothesis\n---\n## Claim\n\nText\n\n## Position history\n\n- 2026-09-21T10:00:00+02:00 · claim\n"
    );
  });

  it("a heading the user renamed is no longer the app's: a fresh section is appended and the renamed one is untouched", async () => {
    const original =
      "---\nkind: hypothesis\n---\n## Claim\n\nText\n\n## Position history (old)\n\n- 2026-01-01T00:00:00Z · claim\n";
    const vault = await vaultWith({ "h.md": original });

    const { after, result } = await applied(
      vault,
      "h.md",
      replaceSection("Position history", "- 2026-09-21T10:00:00+02:00 · claim")
    );

    written(result);
    expect(after).toBe(
      original +
        "\n## Position history\n\n- 2026-09-21T10:00:00+02:00 · claim\n"
    );
  });

  it("a duplicated owned section: the first is written, the second untouched, and the result carries the shape problem", async () => {
    const original =
      "---\nkind: hypothesis\n---\n## Position history\n\n- first\n\n## Criteria\n\n### One ^c1\n\n## Position history\n\n- second copy, mine\n";
    const vault = await vaultWith({ "h.md": original });

    const { after, result } = await applied(
      vault,
      "h.md",
      replaceSection("Position history", "- rewritten")
    );

    expect(after).toBe(
      "---\nkind: hypothesis\n---\n## Position history\n\n- rewritten\n\n## Criteria\n\n### One ^c1\n\n## Position history\n\n- second copy, mine\n"
    );
    expect(written(result).shape).toEqual([
      {
        path: "h.md",
        kind: "hypothesis",
        problem: "ownedSectionDuplicated",
        block: "Position history",
      },
    ]);
  });
});

const prependEntry = (section: string, entry: string): Operation => ({
  op: "prependEntry",
  section,
  entry,
});

describe("prependEntry", () => {
  const revision = (when: string) =>
    `- ${when} · working answer\n  why: [[smith2024#^h3]]\n  from: The previous text.`;

  it("inserts directly after the heading line and its blank line; the existing first entry becomes the second, byte-identical", async () => {
    const original = [
      "---",
      "kind: research-question",
      "---",
      "## Working answer",
      "",
      "Current.",
      "",
      "## Position history",
      "",
      revision("2026-09-01T09:00:00+02:00"),
      "",
    ].join("\n");
    const vault = await vaultWith({ "rq.md": original });
    const read = await readOutline(vault, "rq.md");
    if (!read.readable) throw new Error(read.reason);
    const section = read.outline.headings.find(
      (h) => h.text === "Position history"
    )!;
    const insertionPoint = section.body.start + "\n".length;

    const { after, result } = await applied(
      vault,
      "rq.md",
      prependEntry("Position history", revision("2026-09-21T10:00:00+02:00"))
    );

    written(result);
    expect(after).toBe(
      [
        "---",
        "kind: research-question",
        "---",
        "## Working answer",
        "",
        "Current.",
        "",
        "## Position history",
        "",
        revision("2026-09-21T10:00:00+02:00"),
        revision("2026-09-01T09:00:00+02:00"),
        "",
      ].join("\n")
    );
    expectUntouchedAround(original, after, {
      start: insertionPoint,
      end: insertionPoint,
    });
  });

  it("follows the file's own convention when there is no blank line after the heading, and gives an empty section one", async () => {
    const vault = await vaultWith({
      "tight.md":
        "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n- old\n",
      "empty.md":
        "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n",
      "last-line.md":
        "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history",
    });
    expect(
      (
        await applied(
          vault,
          "tight.md",
          prependEntry("Position history", "- new")
        )
      ).after
    ).toBe(
      "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n- new\n- old\n"
    );
    expect(
      (
        await applied(
          vault,
          "empty.md",
          prependEntry("Position history", "- new")
        )
      ).after
    ).toBe(
      "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n\n- new\n"
    );
    expect(
      (
        await applied(
          vault,
          "last-line.md",
          prependEntry("Position history", "- new")
        )
      ).after
    ).toBe(
      "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n\n- new"
    );
  });

  it("ends its entry with a blank line when what follows is prose, so the prose is never a lazy continuation of the entry", async () => {
    // An entry's last paragraph would otherwise absorb the next unindented
    // line (CommonMark's lazy continuation), and a Revision would read
    // back holding a note the user typed under the heading.
    const vault = await vaultWith({
      "prose.md":
        "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n\na note typed by hand\n\n- old\n  from:\n",
    });
    const { after } = await applied(
      vault,
      "prose.md",
      prependEntry("Position history", "- new\n  from:\n    First.")
    );
    expect(after).toBe(
      "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n\n- new\n  from:\n    First.\n\na note typed by hand\n\n- old\n  from:\n"
    );
  });

  it("appends the section at the end of the file when it is absent, then prepends into it", async () => {
    const original = "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n";
    const vault = await vaultWith({ "h.md": original });
    const { after } = await applied(
      vault,
      "h.md",
      prependEntry("Position history", "- new")
    );
    expect(after).toBe(original + "\n## Position history\n\n- new\n");
  });

  it("two entries prepended in one write land newest first, in operation order", async () => {
    const vault = await vaultWith({
      "h.md":
        "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n\n- old\n",
    });
    const { after } = await applied(
      vault,
      "h.md",
      prependEntry("Position history", "- second"),
      prependEntry("Position history", "- newest")
    );
    expect(after).toBe(
      "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\n\n## Position history\n\n- newest\n- second\n- old\n"
    );
  });
});

const appendToSection = (
  target: Extract<Operation, { op: "appendToSection" }>["target"],
  line: string
): Operation => ({ op: "appendToSection", target, line });

describe("appendToSection", () => {
  it("on a `##` target appends after the section's last non-blank line (Sleep and consolidation.md: `## H1` runs to the end of the file)", async () => {
    const { vault, original } = await copyOf("Sleep and consolidation.md");
    const { after, result } = await applied(
      vault,
      "Sleep and consolidation.md",
      appendToSection({ section: "H1" }, "- [[smith2024#^h3]] — why it is here")
    );
    written(result);
    expect(after).toBe(original + "\n\n- [[smith2024#^h3]] — why it is here");
  });

  it("joins a list it follows; starts its own paragraph after prose; a line into an empty section gets the blank-line convention", async () => {
    const vault = await vaultWith({
      "rq.md": [
        "---",
        "kind: research-question",
        "---",
        "## Working answer",
        "",
        "Current.",
        "",
        "## Supporting sources",
        "",
        "- [[a2020]] — first",
        "",
        "## Opposing sources",
        "",
        "## Related questions",
        "",
        "Some prose the user wrote here.",
        "",
        "## Position history",
        "",
      ].join("\n"),
    });
    const { after } = await applied(
      vault,
      "rq.md",
      appendToSection(
        { section: "Supporting sources" },
        "- [[b2021]] — second"
      ),
      appendToSection({ section: "Opposing sources" }, "- [[c2022]] — against"),
      appendToSection({ section: "Related questions" }, "- [[Other question]]")
    );
    expect(after).toBe(
      [
        "---",
        "kind: research-question",
        "---",
        "## Working answer",
        "",
        "Current.",
        "",
        "## Supporting sources",
        "",
        "- [[a2020]] — first",
        "- [[b2021]] — second",
        "",
        "## Opposing sources",
        "",
        "- [[c2022]] — against",
        "",
        "## Related questions",
        "",
        "Some prose the user wrote here.",
        "",
        "- [[Other question]]",
        "",
        "## Position history",
        "",
      ].join("\n")
    );
  });

  it("on a `###` block id target appends at the end of that block (blocks-on-heading.md: Evidence under ^c1)", async () => {
    const { vault, original } = await copyOf("blocks-on-heading.md");
    const { after, result } = await applied(
      vault,
      "blocks-on-heading.md",
      appendToSection(
        { block: "c1" },
        "- [[run 12]] — what it shows for this criterion"
      )
    );
    written(result);
    expect(after).toBe(
      original.replace(/\n$/, "") +
        "\n\n- [[run 12]] — what it shows for this criterion\n"
    );
  });

  it("an Evidence line joins the criterion's list, before the next criterion, leaving the next criterion byte-identical", async () => {
    const original = [
      "---",
      "kind: hypothesis",
      "---",
      "## Criteria",
      "",
      "### Accuracy holds ^c1",
      "relationship:: confirming",
      "outcome:: inconclusive",
      "- [[run 1]] — first",
      "",
      "### Latency holds ^c2",
      "relationship:: falsifying",
      "outcome:: inconclusive",
      "",
    ].join("\n");
    const vault = await vaultWith({ "h.md": original });
    const { after } = await applied(
      vault,
      "h.md",
      appendToSection({ block: "c1" }, "- [[run 2]] — second")
    );
    expect(after).toBe(
      original.replace(
        "- [[run 1]] — first\n",
        "- [[run 1]] — first\n- [[run 2]] — second\n"
      )
    );
  });

  it("refuses a block id that is not on a `###` heading", async () => {
    const { vault, original } = await copyOf("blocks-handwritten.md");
    const { after, result } = await applied(
      vault,
      "blocks-handwritten.md",
      appendToSection({ block: "h12" }, "- line")
    );
    expect(refused(result).reason).toBe("blockNotFound");
    expect(after).toBe(original);
  });

  it("on `lead` inserts before the first `##` heading — the body before it, after the paragraph the user wrote (Sleep and consolidation.md)", async () => {
    const { vault, original } = await copyOf("Sleep and consolidation.md");
    const { after, result } = await applied(
      vault,
      "Sleep and consolidation.md",
      appendToSection(
        "lead",
        "Answered by [[hypothesis]] — falsified, 2026-09-21"
      )
    );
    written(result);
    expect(after).toBe(
      original.replace(
        "A paragraph with a block id. ^blockid\n",
        "A paragraph with a block id. ^blockid\n\nAnswered by [[hypothesis]] — falsified, 2026-09-21\n"
      )
    );
    // The paragraph's block id is still a block id: the line did not join its paragraph.
    const read = await readOutline(vault, "Sleep and consolidation.md");
    if (!read.readable) throw new Error(read.reason);
    expect(read.outline.blockIds.map((b) => b.id)).toEqual(["blockid"]);
  });

  it("on `lead` never lands inside `## Position history` on a Research Question whose lead is empty (§ Vault layout heading order)", async () => {
    const original = [
      "---",
      "kind: research-question",
      "---",
      "## Working answer",
      "",
      "Current.",
      "",
      "## Supporting sources",
      "",
      "## Opposing sources",
      "",
      "## Related questions",
      "",
      "## Open threads",
      "",
      "## Position history",
      "",
      "- 2026-09-01T09:00:00+02:00 · working answer",
      "",
    ].join("\n");
    const vault = await vaultWith({ "rq.md": original });
    const { after } = await applied(
      vault,
      "rq.md",
      appendToSection(
        "lead",
        "Answered by [[hypothesis]] — falsified, 2026-09-21"
      )
    );
    expect(after).toBe(
      original.replace(
        "---\n## Working answer",
        "---\nAnswered by [[hypothesis]] — falsified, 2026-09-21\n\n## Working answer"
      )
    );
    const read = await readOutline(vault, "rq.md");
    if (!read.readable) throw new Error(read.reason);
    const history = read.outline.headings.find(
      (h) => h.text === "Position history"
    )!;
    expect(after.slice(history.body.start, history.body.end)).toBe(
      "\n- 2026-09-01T09:00:00+02:00 · working answer\n"
    );
  });

  it("on `lead` with no `##` at all appends at the end of the file (a Question's body)", async () => {
    const vault = await vaultWith({
      "q.md":
        "---\nkind: question\nstatus: open\n---\nThe user's answer notes.\n",
      "bare.md": "---\nkind: question\nstatus: open\n---\n",
    });
    expect(
      (
        await applied(
          vault,
          "q.md",
          appendToSection("lead", "Answered by [[h]] — falsified, 2026-09-21")
        )
      ).after
    ).toBe(
      "---\nkind: question\nstatus: open\n---\nThe user's answer notes.\n\nAnswered by [[h]] — falsified, 2026-09-21\n"
    );
    expect(
      (
        await applied(
          vault,
          "bare.md",
          appendToSection("lead", "Answered by [[h]] — falsified, 2026-09-21")
        )
      ).after
    ).toBe(
      "---\nkind: question\nstatus: open\n---\nAnswered by [[h]] — falsified, 2026-09-21\n"
    );
  });
});

const setOutcome = (
  blockId: string,
  value: "met" | "not met" | "inconclusive"
): Operation => ({ op: "setInlineField", blockId, field: "outcome", value });
const setRelationship = (
  blockId: string,
  value: "confirming" | "falsifying" | "diagnostic"
): Operation => ({
  op: "setInlineField",
  blockId,
  field: "relationship",
  value,
});

describe("setInlineField", () => {
  const hypothesis = [
    "---",
    "kind: hypothesis",
    "---",
    "## Claim",
    "",
    "Sparse inputs hold.",
    "",
    "## Criteria",
    "",
    "### Accuracy holds on the held-out set ^c1",
    "relationship:: confirming",
    "outcome:: inconclusive",
    "- [[run 1]] — first",
    "",
    "### Latency stays under 10 ms ^c2",
    "relationship:: falsifying",
    "outcome:: not met",
    "",
    "## Design notes",
    "",
    "outcome:: this is the user's prose, not a field the app owns",
    "",
  ].join("\n");

  it("replaces only the value: the key, the `::`, the criterion text, and `^c<n>` are byte-identical", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const read = await readOutline(vault, "h.md");
    if (!read.readable) throw new Error(read.reason);
    const field = read.outline.inlineFields.find(
      (f) => f.under === "c1" && f.key === "outcome"
    )!;

    const { after, result } = await applied(
      vault,
      "h.md",
      setOutcome("c1", "met")
    );

    written(result);
    expect(after).toBe(
      hypothesis.replace("outcome:: inconclusive", "outcome:: met")
    );
    expectUntouchedAround(hypothesis, after, field.valueRange);
    const reread = await readOutline(vault, "h.md");
    if (!reread.readable) throw new Error(reread.reason);
    expect(reread.criteria).toEqual([
      {
        id: "c1",
        text: "Accuracy holds on the held-out set",
        relationship: "confirming",
        outcome: "met",
      },
      {
        id: "c2",
        text: "Latency stays under 10 ms",
        relationship: "falsifying",
        outcome: "not met",
      },
    ]);
  });

  it("sets both fields of one criterion in one write, and a field on the second criterion, each at its own value", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const { after } = await applied(
      vault,
      "h.md",
      setRelationship("c1", "diagnostic"),
      setOutcome("c1", "not met"),
      setOutcome("c2", "met")
    );
    expect(after).toBe(
      hypothesis
        .replace("relationship:: confirming", "relationship:: diagnostic")
        .replace("outcome:: inconclusive", "outcome:: not met")
        .replace("outcome:: not met\n\n## Design", "outcome:: met\n\n## Design")
    );
  });

  it("adds the field line under the criterion when the criterion has none (blocks-on-heading.md), after its other field when it has one", async () => {
    const { vault, original } = await copyOf("blocks-on-heading.md");
    const { after, result } = await applied(
      vault,
      "blocks-on-heading.md",
      setOutcome("c1", "met")
    );
    written(result);
    expect(after).toBe(
      original.replace(
        "### Criterion text ^c1\n",
        "### Criterion text ^c1\noutcome:: met\n"
      )
    );

    const oneField = await vaultWith({
      "h.md":
        "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\nrelationship:: confirming\n- [[run]] — note\n",
    });
    expect(
      (await applied(oneField, "h.md", setOutcome("c1", "met"))).after
    ).toBe(
      "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\nrelationship:: confirming\noutcome:: met\n- [[run]] — note\n"
    );
  });

  it("leaves a block id the user put at the end of the field line where it is — only the value changes", async () => {
    const original =
      "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\nrelationship:: confirming\noutcome:: inconclusive ^my-id\n";
    const vault = await vaultWith({ "h.md": original });
    const { after, result } = await applied(
      vault,
      "h.md",
      setOutcome("c1", "met")
    );
    written(result);
    expect(after).toBe(original.replace("inconclusive ^my-id", "met ^my-id"));
  });

  it("refuses a block id that is not a criterion: a `^c<n>` outside `## Criteria`, a `###` with another id, a paragraph's id", async () => {
    const original = [
      "---",
      "kind: hypothesis",
      "---",
      "## Criteria",
      "",
      "### Real ^c1",
      "outcome:: inconclusive",
      "",
      "### Not a criterion ^my-own-id",
      "outcome:: inconclusive",
      "",
      "## Design notes",
      "",
      "### Looks like one ^c2",
      "outcome:: inconclusive",
      "",
      "A paragraph. ^c3",
      "",
    ].join("\n");
    const vault = await vaultWith({ "h.md": original });
    for (const id of ["my-own-id", "c2", "c3", "c9"]) {
      const { after, result } = await applied(
        vault,
        "h.md",
        setOutcome(id, "met")
      );
      expect(refused(result).reason, id).toBe("notACriterion");
      expect(after).toBe(original);
    }
  });
});

describe("verification: re-parse before the write reaches disk", () => {
  const hypothesis =
    "---\nkind: hypothesis\n---\n## Criteria\n\n### One ^c1\noutcome:: inconclusive\n\n## Position history\n\n- old\n";

  it("refuses a replaceSection whose range ate the heading (fault-injected), and writes nothing", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const hash = await basedOn(vault, "h.md");
    fault.tamper = (outline) => {
      const heading = outline.headings.find(
        (h) => h.text === "Position history"
      )!;
      heading.body.start = heading.range.start;
    };

    const result = await write(vault, "h.md", {
      operations: [replaceSection("Position history", "- new")],
      basedOn: hash,
    });
    const after = await bytes(join(vault, "h.md"));

    expect(fault.tamper).toBeNull();
    expect(refused(result).reason).toBe("verificationFailed");
    expect(refused(result).detail).toMatch(/Position history/);
    expect(after).toBe(hypothesis);
  });

  it("refuses a setInlineField whose range ate the criterion's block id (fault-injected)", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const hash = await basedOn(vault, "h.md");
    fault.tamper = (outline) => {
      const field = outline.inlineFields.find((f) => f.under === "c1")!;
      const heading = outline.headings.find((h) => h.blockId === "c1")!;
      field.valueRange.start = heading.range.start;
    };

    const result = await write(vault, "h.md", {
      operations: [setOutcome("c1", "met")],
      basedOn: hash,
    });
    const after = await bytes(join(vault, "h.md"));

    expect(refused(result).reason).toBe("verificationFailed");
    expect(refused(result).detail).toMatch(/c1/);
    expect(after).toBe(hypothesis);
  });
});

describe("re-apply: the file changed between the read and the write (#121's path, for each section operation)", () => {
  const hypothesis = [
    "---",
    "kind: hypothesis",
    "---",
    "## Claim",
    "",
    "Sparse inputs hold.",
    "",
    "## Criteria",
    "",
    "### One ^c1",
    "relationship:: confirming",
    "outcome:: inconclusive",
    "",
    "## Position history",
    "",
    "- old",
    "",
  ].join("\n");
  const edited = hypothesis.replace(
    "Sparse inputs hold.",
    "Sparse inputs hold, the user now adds."
  );

  async function staleThenEdited(): Promise<{ vault: string; stale: string }> {
    const vault = await vaultWith({ "h.md": hypothesis });
    const stale = await basedOn(vault, "h.md");
    await writeFile(join(vault, "h.md"), edited);
    return { vault, stale };
  }

  const cases: [string, Operation, string][] = [
    [
      "replaceSection",
      replaceSection("Position history", "- rewritten"),
      edited.replace("- old\n", "- rewritten\n"),
    ],
    [
      "prependEntry",
      prependEntry("Position history", "- new"),
      edited.replace("- old\n", "- new\n- old\n"),
    ],
    [
      "appendToSection",
      appendToSection({ block: "c1" }, "- [[run]] — note"),
      edited.replace(
        "outcome:: inconclusive\n",
        "outcome:: inconclusive\n\n- [[run]] — note\n"
      ),
    ],
    [
      "setInlineField",
      setOutcome("c1", "met"),
      edited.replace("outcome:: inconclusive", "outcome:: met"),
    ],
  ];

  for (const [name, operation, expected] of cases) {
    it(`${name}: the user's edit and the app's are both present`, async () => {
      const { vault, stale } = await staleThenEdited();
      const result = written(
        await write(vault, "h.md", { operations: [operation], basedOn: stale })
      );
      expect(await bytes(join(vault, "h.md"))).toBe(expected);
      expect(result.hash).toBe(sha256(expected));
    });
  }

  it("changedAndUnreapplyable when the criterion block is gone, and nothing is written", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const stale = await basedOn(vault, "h.md");
    const gone = hypothesis.replace("### One ^c1\n", "### One\n");
    await writeFile(join(vault, "h.md"), gone);

    const result = refused(
      await write(vault, "h.md", {
        operations: [setOutcome("c1", "met")],
        basedOn: stale,
      })
    );

    expect(result.reason).toBe("changedAndUnreapplyable");
    expect(result.detail).toMatch(/c1/);
    expect(await bytes(join(vault, "h.md"))).toBe(gone);
  });

  it("a section duplicated meanwhile is written first-only and reported, as on any read (ADR 0008 decision 10)", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const stale = await basedOn(vault, "h.md");
    const duplicated =
      hypothesis + "\n## Position history\n\n- the user's copy\n";
    await writeFile(join(vault, "h.md"), duplicated);

    const result = written(
      await write(vault, "h.md", {
        operations: [prependEntry("Position history", "- new")],
        basedOn: stale,
      })
    );

    expect(await bytes(join(vault, "h.md"))).toBe(
      duplicated.replace("- old\n", "- new\n- old\n")
    );
    expect(result.shape).toEqual([
      {
        path: "h.md",
        kind: "hypothesis",
        problem: "ownedSectionDuplicated",
        block: "Position history",
      },
    ]);
  });
});

describe("block ids the user wrote", () => {
  it("the per-Source `h` counter starts above the highest ^h<digits> in the file: ^h7 → ^h8, never ^h1; ^h12 in blocks-handwritten.md → ^h13; none → ^h1", async () => {
    const { vault } = await copyOf("blocks-handwritten.md");
    const handwritten = await readOutline(vault, "blocks-handwritten.md");
    if (!handwritten.readable) throw new Error(handwritten.reason);
    expect(nextBlockId(handwritten.outline, "h")).toBe("h13");

    const more = await vaultWith({
      "s.md":
        "---\nkind: source\n---\nQuote. ^h7\n\nAnother. ^h2\n\nNot ours. ^hx9\n",
      "fresh.md": "---\nkind: source\n---\nNothing yet.\n",
    });
    const seven = await readOutline(more, "s.md");
    const fresh = await readOutline(more, "fresh.md");
    if (!seven.readable || !fresh.readable) throw new Error("unreadable");
    expect(nextBlockId(seven.outline, "h")).toBe("h8");
    expect(nextBlockId(fresh.outline, "h")).toBe("h1");
  });

  it("a user's ^my-own-id, ^h12, and ^c3 survive every operation, in place (blocks-handwritten.md)", async () => {
    const { vault, original } = await copyOf("blocks-handwritten.md");
    const { after, result } = await applied(
      vault,
      "blocks-handwritten.md",
      appendToSection("lead", "Answered by [[h]] — falsified, 2026-09-21"),
      replaceSection("Annotations", '- p.1 · "quote" ^h13'),
      prependEntry("Position history", "- entry"),
      appendToSection({ section: "Annotations" }, '- p.2 · "second" ^h14')
    );
    written(result);
    expect(after.startsWith(original.replace(/\n+$/, ""))).toBe(true);
    const read = await readOutline(vault, "blocks-handwritten.md");
    if (!read.readable) throw new Error(read.reason);
    expect(read.outline.blockIds.map((b) => b.id)).toEqual([
      "h12",
      "c3",
      "my-own-id",
      "h13",
      "h14",
    ]);
  });
});

describe("EOL and BOM through a section operation", () => {
  it("a CRLF file with a BOM stays CRLF with its BOM; the app's lines take the file's endings", async () => {
    const original =
      "﻿---\r\nkind: hypothesis\r\n---\r\n## Criteria\r\n\r\n### One ^c1\r\noutcome:: inconclusive\r\n\r\n## Position history\r\n\r\n- old\r\n";
    const vault = await vaultWith({ "h.md": original });
    const { after } = await applied(
      vault,
      "h.md",
      prependEntry("Position history", "- new\n  from: before"),
      appendToSection({ block: "c1" }, "- [[run]] — note"),
      setOutcome("c1", "met"),
      replaceSection("Annotations", "- a\n- b\n")
    );
    expect(after).toBe(
      "﻿---\r\nkind: hypothesis\r\n---\r\n## Criteria\r\n\r\n### One ^c1\r\noutcome:: met\r\n\r\n- [[run]] — note\r\n\r\n## Position history\r\n\r\n- new\r\n  from: before\r\n- old\r\n\r\n## Annotations\r\n\r\n- a\r\n- b\r\n"
    );
  });
});

describe("blank lines around an owned section, at the edges", () => {
  it("replaceSection with an empty body between two headings leaves one blank line, not two", async () => {
    const vault = await vaultWith({
      "s.md": "---\nkind: source\n---\n## Annotations\n\n- gone\n\n## After\n",
    });
    expect(
      (await applied(vault, "s.md", replaceSection("Annotations", ""))).after
    ).toBe("---\nkind: source\n---\n## Annotations\n\n## After\n");
  });

  it("a line into an empty section that runs straight into the next heading gets a blank line on both sides", async () => {
    const vault = await vaultWith({
      "tight.md": "---\nkind: source\n---\n## Annotations\n## After\n",
      "one.md": "---\nkind: source\n---\n## Annotations\n\n## After\n",
    });
    expect(
      (
        await applied(
          vault,
          "tight.md",
          appendToSection({ section: "Annotations" }, "- x")
        )
      ).after
    ).toBe("---\nkind: source\n---\n## Annotations\n\n- x\n\n## After\n");
    expect(
      (await applied(vault, "one.md", prependEntry("Annotations", "- x"))).after
    ).toBe("---\nkind: source\n---\n## Annotations\n\n- x\n\n## After\n");
  });
});
