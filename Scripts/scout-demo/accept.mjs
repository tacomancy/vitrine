// 4. `A` on the card in hand writes the stub; Loose Ends then lists it under
// Unfinished reading, with no PDF.
import { openQueue, press } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await page.wait("!!document.querySelector('article[aria-label]')", 10000);
  const title = await page.eval(
    "document.querySelector('article[aria-label]').getAttribute('aria-label')"
  );
  console.log(`ACCEPTING: ${title}`);
  await press(page, "a");
  await page.eval("location.hash='#/loose-ends'");
  await page.wait(
    "document.body.innerText.toLowerCase().includes('unfinished reading')",
    10000
  );
  await page.wait(
    `document.body.innerText.includes(${JSON.stringify(title.slice(0, 20))})`,
    10000
  );
  console.log(
    `LOOSE ENDS: ${await page.eval("document.body.innerText.slice(0, 900)")}`
  );
};
