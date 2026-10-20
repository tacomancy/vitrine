// 3. Run now: the Scout asks arXiv for the Lexicon as it is now.
import { NAME, railText, runNow, openQueue } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await runNow(page, NAME);
  await page.sleep(6000);
  console.log(`RAIL: ${await railText(page)}`);
};
