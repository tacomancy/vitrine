// 2. The lab moves its page: the old address 404s, and the Scout says so.
import {
  NAME,
  storeKey,
  expect,
  openQueue,
  railText,
  runNow,
} from "./helpers.mjs";
export default async (page) => {
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await runNow(page, NAME);
  await page.wait("document.body.innerText.includes('404')", 20000);
  const rail = await railText(page);
  expect(rail.includes("404"), "the rail names the failed read");
  console.log(`RAIL: ${rail}`);
};
