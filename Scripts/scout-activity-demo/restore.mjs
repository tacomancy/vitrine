// 6. Restored from the dropped line: it is back in the table with its history.
import { click, expect, names, openActivity } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page, 11);
  await page.eval(
    "[...document.querySelectorAll('button')].find(b=>/\\d+ dropped/.test(b.textContent)).click()"
  );
  await page.wait(
    "!!document.querySelector('ul[aria-label=\"Dropped Scouts\"]')"
  );
  await click(page, "Stale topic: restore");
  await page.wait(
    "document.querySelectorAll('table[aria-label=\"Scouts\"] tbody th').length >= 12",
    15000
  );
  expect((await names(page)).includes("Stale topic"), "its row is back");
  expect(
    !(await page.eval(
      "[...document.querySelectorAll('button')].some(b=>/\\d+ dropped/.test(b.textContent))"
    )),
    "the dropped line is gone with nothing dropped"
  );
  const row = await page.eval(
    "[...document.querySelectorAll('table[aria-label=\"Scouts\"] tbody tr')].find(r=>r.querySelector('th')?.innerText.startsWith('Stale topic')).innerText"
  );
  console.log(`RESTORED: ${row.replace(/\s+/g, " ")}`);
  expect(
    row.includes("30%") && row.includes("3 pending"),
    "its accept rate and its Proposals came back with it"
  );
};
