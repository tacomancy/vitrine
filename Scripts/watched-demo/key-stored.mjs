// 3. A key is stored in Settings and the waiting Scout starts by itself —
// nobody presses Run now. The page is extracted, verified, and the invented
// paper is dropped and counted.
import { chooseFirstLook, openQueue, railText, storeKey } from "./helpers.mjs";
// A Lane's tab carries its count (*Review 2*), so it is found by its first word.
const laneTab = (lane) =>
  `[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim().startsWith(${JSON.stringify(lane)}))`;

export default async (page) => {
  await page.eval("location.hash='#/settings'");
  await page.wait("document.body.innerText.includes('Lab page')", 10000);
  console.log(
    `WAITING: ${await page.eval("document.body.innerText.split(/what it talks to/i)[1] ?? ''")}`
  );
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await chooseFirstLook(page, "Lab page", 30000);
  // Verification's point: the model's invented paper is on no page, so it is
  // no card in any Lane of the Queue.
  for (const lane of ["Review", "Skim"]) {
    await page.eval(`${laneTab(lane)}.click()`);
    if (
      await page.eval(
        "document.body.innerText.includes('Sleep Cures Everything')"
      )
    )
      throw new Error("the invented paper reached the Queue");
  }
  console.log("INVENTED PAPER IN THE QUEUE: false");
  await page.eval(`${laneTab("Review")}.click()`);
  console.log(`RAIL: ${await railText(page)}`);
};
