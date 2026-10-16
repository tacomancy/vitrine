// 4a. The next launch checks it: the first look at the new page, on the
// Review stack, and the rail's sentence about the page it now reads.
import { NAME, storeKey, expect, openQueue, railText } from "./helpers.mjs";
export default async (page) => {
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await page.wait(
    "!document.body.innerText.includes('this page has not been read')",
    30000
  );
  await page.wait("!!document.querySelector('article[aria-label]')", 20000);
  const rail = await railText(page);
  expect(rail.includes(NAME), "it is the same Scout");
  console.log(`RAIL: ${rail}`);
  console.log(
    `REVIEW: ${await page.eval("document.querySelector('[aria-label=\"Scout Queue\"]').innerText.slice(0, 900)")}`
  );
};
