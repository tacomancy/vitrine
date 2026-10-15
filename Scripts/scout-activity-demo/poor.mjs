// 2. The poor Scout opened: its weekly line, its headline rate, its runs.
import { click, expect, openActivity, rowText } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page);
  await click(page, "Dream reports: accept rate, 10% · 120 triaged");
  await page.sleep(800);
  const text = await page.eval(
    "document.querySelector('table[aria-label=\"Scouts\"]').innerText"
  );
  expect(text.includes("10%"), "its headline rate is on the screen");
  expect(
    await page.eval(
      "!!document.querySelector('table[aria-label=\"Scouts\"] svg path')"
    ),
    "the weekly line is drawn"
  );
  console.log(
    `POOR: ${(await rowText(page, "Dream reports")).replace(/\s+/g, " ")}`
  );
  const detail = await page.eval(
    'document.querySelector(\'table[aria-label="Scouts"] tr[id$="-detail"], table[aria-label="Scouts"] tr[id]:last-child\')?.innerText ?? \'\''
  );
  console.log(`LINE: ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
};
