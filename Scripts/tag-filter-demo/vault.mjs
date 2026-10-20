// The scratch vault the Tag Filter demo runs on (#692): the fixture vault plus
// three papers in a `probing` Tag, whose Lexicon therefore has Terms to
// compile, and one paper in a `bare` Tag too thin to have any. A Scout file
// written by hand names `bare`: the file is the truth (ADR 0009), so this is
// also a Scout whose Tag lost its Terms after it was saved.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The word before each Tag name is what makes the three papers differ, so the
// Lexicon has Terms (a phrase must recur across papers) beside noise to rank.
const paper = (tag, n, phrase, partner) =>
  `---\nkind: source\ncitekey: ${tag}${n}\ntitle: ${phrase} study ${n}\nyear: 2024\ntags:\n  - ${tag}\n---\n> The ${phrase} appears with ${partner} in trial ${["amber", "birch", "cobalt"][n]}${tag}.\n> A partner sentence about ${["amber", "birch", "cobalt"][n]}${tag}z and ${partner}.\n`;

export function tagFilterVault(fixture, vault) {
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, "sources/tags"), { recursive: true });
  for (let n = 0; n < 3; n++)
    writeFileSync(
      join(vault, `sources/tags/probing-${n}.md`),
      paper("probing", n, "linear probe", "layer wise")
    );
  writeFileSync(
    join(vault, "sources/tags/bare-0.md"),
    `---\nkind: source\ncitekey: bare0\ntitle: A thin paper\nyear: 2024\ntags:\n  - bare\n---\n> Rest helps.\n`
  );
  mkdirSync(join(vault, ".vitrine/scouts"), { recursive: true });
  writeFileSync(
    join(vault, ".vitrine/scouts/bare-watch.yaml"),
    "name: Bare watch\ncadence: daily\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  tags:\n    - bare\n"
  );
}
