// The scratch vaults the Question Map demo runs on (#494). Generated rather
// than committed: the fixture vault is deliberately small, and the Map's cut
// (24 × 22) needs more rows and Tags than any fixture should carry.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AREAS = 5;
const TAGS_PER_AREA = 5; // 25 Tags: three more than the 22 columns shown
const SOURCES = 30;
const QUESTIONS = 28; // 25 anchored + 3 unanchored: four more than the 24 rows
const UNANCHORED = 3;

const tagOf = (i) =>
  `area${(i % AREAS) + 1}/topic${(Math.floor(i / AREAS) % TAGS_PER_AREA) + 1}`;

/** Fixture vault plus the generated Questions and Sources; returns the unanchored Questions' names. */
export function mapVault(fixture, vault) {
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, "sources/gen"), { recursive: true });
  mkdirSync(join(vault, "map"), { recursive: true });
  for (let s = 0; s < SOURCES; s++) {
    writeFileSync(
      join(vault, `sources/gen/gen-source-${s}.md`),
      `---\nkind: source\ncitekey: gen${s}\ntitle: Generated source ${s}\nyear: ${2000 + s}\ntags:\n  - ${tagOf(s)}\n---\n`
    );
  }
  // Sources no Question reaches, in two sub-Tags of one parent: the
  // unquestioned-knowledge reading counts two Tags at depth 2 and one at
  // depth 1, so a depth change moves the readings as well as the matrix.
  for (const sub of ["a", "b"]) {
    writeFileSync(
      join(vault, `sources/gen/orphan-${sub}.md`),
      `---\nkind: source\ncitekey: orphan${sub}\ntitle: Orphan ${sub}\nyear: 2001\ntags:\n  - orphan/${sub}\n---\n`
    );
  }
  const unanchored = [];
  for (let q = 0; q < QUESTIONS; q++) {
    const bare = q >= QUESTIONS - UNANCHORED;
    // Anchored Questions reach one to four sources, so the cells span bins.
    const related = bare
      ? []
      : Array.from({ length: (q % 4) + 1 }, (_, k) => (q + k * 7) % SOURCES);
    const name = `Map question ${q}`;
    // An unanchored Question carries the Tag of sources it does not link, so
    // the review has papers to offer it (CONTEXT § Candidate link).
    const tags = bare ? [tagOf(q), tagOf(q + 5)] : [tagOf(q)];
    writeFileSync(
      join(vault, `map/${name}.md`),
      `---\nid: mq${String(q).padStart(3, "0")}xxxxxx\nkind: question\nquestion: ${name}?\nstatus: open\ncaptured: 2026-09-${String(1 + (q % 28)).padStart(2, "0")}T09:00:00+01:00\ncontext: other\ntags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n${related.length === 0 ? "" : `related:\n${related.map((s) => `  - "[[gen-source-${s}]]"`).join("\n")}\n`}---\n`
    );
    if (bare) unanchored.push(name);
  }
  return unanchored;
}

/** A vault with notes and nothing the Map reads. */
export function emptyVault(vault) {
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(vault, "A note.md"), "# A note\n\nNothing to map.\n");
}

/** Enough notes that the first read takes long enough to be caught mid-build. */
export function bigVault(vault, notes = 12000) {
  emptyVault(vault);
  mkdirSync(join(vault, "filler"), { recursive: true });
  for (let n = 0; n < notes; n++) {
    writeFileSync(
      join(vault, `filler/note-${n}.md`),
      `---\ntags:\n  - filler/n${n % 40}\n---\n\n# Note ${n}\n\n${"Filler prose to be read. ".repeat(40)}\n`
    );
  }
}
