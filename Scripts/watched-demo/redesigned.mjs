// 5. The lab redesigns its page. A good key; *run now* finds nothing where
// papers were listed, and the rail says the structure changed.
import { openQueue, rail, runNow, storeKey } from "./helpers.mjs";
export default async (page) => {
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await runNow(page, "Lab page");
  await page.wait(
    "(document.querySelector('ul[aria-label=\"Scouts\"]')?.innerText ?? '').toLowerCase().includes('its structure changed')",
    25000
  );
  console.log(`RAIL: ${await rail(page)}`);
};
