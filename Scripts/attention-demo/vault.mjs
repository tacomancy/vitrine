// The scratch vault the attention demo runs on (#658): the fixture vault plus
// papers in five Tags the scatter can place, one with too few papers and one
// whose field is too thin, and an unanchored Question with a paper no Tag
// reaches but whose words match its Tag's Lexicon.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Each field: the Tag, the phrase its papers recur on (and so its Lexicon's
 * strongest Term and the key the stand-in answers by), how many papers, and
 * the works a month the stand-in reports in the 12 months before the last 12
 * and in the last 12. Papers 3 – 7 against growth −50 % – +114 % spread the
 * points over all four quadrants of a median split.
 */
export const FIELDS = [
  {
    tag: "replay",
    phrase: "hippocampal replay",
    second: "sharp wave",
    papers: 3,
    prior: 8,
    recent: 22,
  },
  {
    tag: "consolidation",
    phrase: "memory consolidation",
    second: "slow wave",
    papers: 7,
    prior: 14,
    recent: 30,
  },
  {
    tag: "spindles",
    phrase: "sleep spindle",
    second: "thalamic reticular",
    papers: 4,
    prior: 10,
    recent: 9,
  },
  {
    tag: "engrams",
    phrase: "engram allocation",
    second: "creb excitability",
    papers: 6,
    prior: 12,
    recent: 6,
  },
  {
    tag: "oscillations",
    phrase: "theta oscillation",
    second: "phase coupling",
    papers: 3,
    prior: 15,
    recent: 15,
  },
  // 3 papers, but the field holds 3 a month: under the 50-work floor.
  {
    tag: "tectum",
    phrase: "zebrafish tectum",
    second: "retinal ganglion",
    papers: 3,
    prior: 3,
    recent: 4,
  },
  // 2 papers: too few to place whatever the field says.
  {
    tag: "dreams",
    phrase: "dream report",
    second: "rem awakening",
    papers: 2,
    prior: 20,
    recent: 20,
  },
];

const WORDS = [
  "amber",
  "birch",
  "cobalt",
  "dune",
  "ember",
  "fjord",
  "glacier",
  "harbor",
];

/** A Source whose abstract (the `> ` lines a stub is made with) holds both phrases, plus words no other paper shares. */
const paper = (tag, n, { phrase, second }) =>
  `---\nkind: source\ncitekey: ${tag}${n}\ntitle: ${phrase} study ${n}\nyear: 2024\ntags:\n  - ${tag}\n---\n> The ${phrase} appears with ${second} in trial ${WORDS[n]}${tag}.\n> A second sentence about ${WORDS[n]}${tag}z and ${second}.\n`;

/** Fixture vault plus the fields; returns the unanchored Question's name. */
export function attentionVault(fixture, vault) {
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, "sources/attn"), { recursive: true });
  mkdirSync(join(vault, "attn"), { recursive: true });
  for (const field of FIELDS)
    for (let n = 0; n < field.papers; n++)
      writeFileSync(
        join(vault, `sources/attn/${field.tag}-${n}.md`),
        paper(field.tag, n, field)
      );
  // No Tag, so only its words can bring it to the Question below: it holds
  // two of the replay Lexicon's Terms.
  writeFileSync(
    join(vault, "sources/attn/untagged-replay.md"),
    `---\nkind: source\ncitekey: untaggedreplay\ntitle: Untagged replay paper\nyear: 2025\n---\n> Hippocampal replay accompanies the sharp wave in a model nobody tagged.\n`
  );
  const question = "What does replay carry across sleep";
  writeFileSync(
    join(vault, "attn/Replay question.md"),
    `---\nid: attnq00001\nkind: question\nquestion: ${question}?\nstatus: open\ncaptured: 2026-10-01T09:00:00+01:00\ncontext: other\ntags:\n  - replay\n---\n`
  );
  return question;
}
