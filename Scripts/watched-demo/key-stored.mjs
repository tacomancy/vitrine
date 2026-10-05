// 3. A key is stored in Settings and the waiting Scout starts by itself —
// nobody presses Run now. The page is extracted, verified, and the invented
// paper is dropped and counted.
import { openQueue, rail, storeKey } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/settings'");
  await page.wait("document.body.innerText.includes('Lab page')", 10000);
  console.log(
    `WAITING: ${await page.eval("document.body.innerText.split(/what it talks to/i)[1] ?? ''")}`
  );
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await page.wait("!!document.querySelector('article[aria-label]')", 30000);
  console.log(`RAIL: ${await rail(page)}`);
};
