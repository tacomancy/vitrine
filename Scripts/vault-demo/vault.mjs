// The scratch vault the Vault demo runs on (#704): the fixture vault, which
// holds a Question, a Research Question, a Hypothesis, Experiments, a Source
// with its PDF, one whose PDF is missing and a stub, plus the notes a Vault
// surface is for — a note that links two highlights of a Source, one that only
// names it, a CRLF note with no trailing newline, one whose links are every
// kind the classifier distinguishes, and a tag the grammar refuses (digits only, in frontmatter).
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CRLF_NOTE = "notes/CRLF note.md";
export const CRLF_BYTES = "First line\r\nSecond line, no newline at the end";
export const READING_LOG = "notes/Reading log.md";
export const LINKS_NOTE = "notes/Links.md";

export function vaultDemoVault(fixture, vault) {
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, "notes"), { recursive: true });
  // Two highlights with the ids the Reader writes, so a note can link each.
  appendFileSync(
    join(vault, "sources/rasch2013.md"),
    '\n## Annotations\n\n- p.3 · "sleep benefits declarative memory" ^h1\n\n- p.9 · "slow-wave sleep carries the effect" ^h2\n'
  );
  writeFileSync(
    join(vault, READING_LOG),
    "---\ntags:\n  - memory/encoding\n---\n\n# Reading log\n\nTwo passages I keep coming back to: [[rasch2013#^h1]] and [[rasch2013#^h2]].\nThe wider argument is in [[Sleep and consolidation]]. #memory/consolidation/spindles\n"
  );
  writeFileSync(
    join(vault, "notes/Lab chatter.md"),
    '---\ntags:\n  - "2024"\n---\n\nA talk today leaned on rasch2013 without saying which passage. Worth a note.\n'
  );
  writeFileSync(join(vault, CRLF_NOTE), CRLF_BYTES);
  writeFileSync(
    join(vault, LINKS_NOTE),
    "# Links\n\nA paper: [[rasch2013]]\n\nA note: [[Sleep and consolidation]]\n\nA dead end: [[never written]]\n\n[a web page](https://example.org) and [a file](file:///etc/hosts)\n"
  );
}
