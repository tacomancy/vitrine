// 4. A Source's backlinks group by the highlight they target, file-level
// links beneath; unlinked mentions of its name below.
import { expect, openFile } from "./helpers.mjs";
export default async (page) => {
  await openFile(page, "sources/rasch2013.md");
  await page.wait(
    "!!document.querySelector('[aria-label=\"Backlinks\"] [role=group]')",
    15000
  );
  const groups = await page.eval(
    `[...document.querySelectorAll('[aria-label="Backlinks"] [role=group]')].map(g=>g.getAttribute('aria-label')+': '+g.innerText.replace(/\\s+/g,' '))`
  );
  console.log(`4. GROUPS: ${groups.join(" || ")}`);
  const labels = groups.map((g) => g.split(":")[0]);
  expect(
    labels.includes("^h1") && labels.includes("^h2"),
    "backlinks group by ^h1 and ^h2"
  );
  await page.wait(
    "!!document.querySelector('[aria-label=\"Unlinked mentions\"] [role=option]')",
    15000
  );
  const mentions = await page.eval(
    "document.querySelector('[aria-label=\"Unlinked mentions\"]').innerText"
  );
  expect(mentions.includes("Lab chatter"), "an unlinked mention of rasch2013");
  console.log(`4. UNLINKED: ${mentions.replace(/\s+/g, " ")}`);
};
