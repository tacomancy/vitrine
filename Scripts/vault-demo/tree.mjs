// 1. The files tab: a Kind glyph per file, a Source's annotation count,
// `.vitrine/` hidden; a note open beside it with its backlinks.
import { expect, openFile } from "./helpers.mjs";
import { READING_LOG } from "./vault.mjs";
export default async (page) => {
  await page.eval("location.hash='#/vault'");
  await page.wait(
    "!!document.querySelector('[aria-label=\"Files\"] [role=treeitem]')",
    15000
  );
  await page.eval(
    `[...document.querySelectorAll('[aria-label="Files"] [aria-expanded=false]')].forEach(r=>r.click())`
  );
  const rows = await page.eval(
    `[...document.querySelectorAll('[aria-label="Files"] [role=treeitem]')].map(r=>({label:r.getAttribute('aria-label'),glyph:r.querySelector('span')?.textContent}))`
  );
  console.log(
    `TREE: ${rows.map((r) => `${r.glyph ?? ""} ${r.label}`).join(" | ")}`
  );
  const glyphs = new Set(rows.map((r) => r.glyph));
  // Question, Research Question, Hypothesis, Experiment, Source, stub.
  for (const g of ["◆", "●", "○", "■", "▲", "▼"])
    expect(glyphs.has(g), `the tree draws ${g} for a Kind`);
  expect(
    rows.some((r) => /^rasch2013, .*2 annotations$/.test(r.label)),
    "rasch2013 shows its two annotations"
  );
  expect(!rows.some((r) => r.label.includes(".vitrine")), ".vitrine is hidden");
  await openFile(page, READING_LOG);
};
