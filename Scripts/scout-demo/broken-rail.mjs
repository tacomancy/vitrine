// 5a. The stand-in answers 503; the Scout is run and the rail takes the
// *wrong* voice, with the fault's sentence.
import { openQueue, railText, runNow } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await runNow(page, "Overnight benefit");
  await page.wait("document.body.innerText.includes('HTTP 503')", 20000);
  console.log(`RAIL: ${await railText(page)}`);
};
