// The scratch vault the OpenAlex demo runs on (#810): the fixture vault plus a
// `probing` Tag of three papers, so a Tag Filter and the scatter's sync both
// have Terms to compile. Scouts are made by the drives (the form) or written
// here by a step that needs one already on disk — the file is the truth
// (ADR 0009).
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tagFilterVault } from "../tag-filter-demo/vault.mjs";

export function openalexVault(fixture, vault) {
  tagFilterVault(fixture, vault);
  // The Tag Filter demo's Scout that fails by name is that demo's, not this one's.
  rmSync(join(vault, ".vitrine/scouts/bare-watch.yaml"));
}

/** A hand-written Scout file, for a step that starts from one that already exists. */
export function writeScout(vault, id, yaml) {
  mkdirSync(join(vault, ".vitrine/scouts"), { recursive: true });
  writeFileSync(join(vault, `.vitrine/scouts/${id}.yaml`), yaml);
}
