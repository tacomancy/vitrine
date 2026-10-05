// 4. The provider refuses the key: the *wrong* voice on the rail.
import { openQueue, railText, runNow, storeKey } from "./helpers.mjs";
export default async (page) => {
  await storeKey(page, "sk-demo-refused");
  await openQueue(page);
  await runNow(page, "Lab page");
  await page.wait(
    "document.body.innerText.includes('refused the stored key')",
    20000
  );
  console.log(`RAIL: ${await railText(page)}`);
};
