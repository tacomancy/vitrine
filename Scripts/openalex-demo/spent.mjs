// 7b. The budget is spent: a Scout run meets the 429 and the Scout is waiting,
// not broken — on the rail and in Loose Ends, in a sentence that blames no one.
import { budget, expect, openQueue, railText, runNow } from "./helpers.mjs";
export default async (page) => {
  await budget("spent");
  await openQueue(page);
  await runNow(page, "Broad watch");
  await page.wait(
    "(document.querySelector('ul[aria-label=\"Scouts\"]')?.innerText ?? '').includes('midnight UTC')",
    30000
  );
  const rail = await railText(page);
  console.log(`RAIL: ${rail.replace(/\n+/g, " | ")}`);
  expect(!/broken|wrong/i.test(rail), "a spent budget is not broken");
  await page.eval("location.hash='#/loose-ends'");
  await page.wait("document.body.innerText.includes('Broad watch')", 20000);
  const ends = await page.eval("document.body.innerText");
  expect(
    ends.includes("midnight UTC"),
    "Loose Ends says it resets at midnight UTC"
  );
};
