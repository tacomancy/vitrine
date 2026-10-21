// The scratch vault the Graph demo runs on (#746): the fixture vault plus a
// hub note whose neighbourhood shows every behaviour of the graph at once.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HUB = "notes/Hub.md";
const TOPICS = 45; // past the first Ring's cap of 40, so the overflow shows

export function graphDemoVault(fixture, vault) {
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, "notes/a"), { recursive: true });
  mkdirSync(join(vault, "notes/b"), { recursive: true });
  // Two files answer to [[Twin]]: an ambiguous link, which is Not drawn.
  writeFileSync(join(vault, "notes/a/Twin.md"), "# Twin\n");
  writeFileSync(join(vault, "notes/b/Twin.md"), "# Twin\n");
  const topic = (n) => `Topic ${String(n).padStart(2, "0")}`;
  const links = [
    "[[rasch2013]]",
    "[[born2010]]",
    "[[klinzing2019]]",
    "[[Is the overnight benefit consolidation or encoding (RQ)]]",
    "[[Sleep and consolidation]]",
    "[[Twin]]",
    "[[never written]]",
    ...Array.from({ length: TOPICS }, (_, i) => `[[${topic(i + 1)}]]`),
  ];
  writeFileSync(join(vault, HUB), `# Hub\n\n${links.join("\n\n")}\n`);
  for (let i = 1; i <= TOPICS; i++) {
    // Every third Topic links onward, so the outer Ring has files, and the
    // first few link back to the hub's Sources, so some have more links.
    const onward = i % 3 === 0 ? `\n\nOn: [[Detail ${i}]]` : "";
    const back = i <= 5 ? "\n\nSee [[rasch2013]]." : "";
    writeFileSync(
      join(vault, `notes/${topic(i)}.md`),
      `# ${topic(i)}\n\nBack to [[Hub]].${back}${onward}\n`
    );
    if (i % 3 === 0)
      writeFileSync(join(vault, `notes/Detail ${i}.md`), `# Detail ${i}\n`);
  }
}
