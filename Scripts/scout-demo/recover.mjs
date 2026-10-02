// 6. The stand-in is well again. Opening the vault runs the Scouts that are
// due, and a failed HTTP run is due again at the next check (ADR 0016
// decision 3), so nobody has to press anything: the Loose Ends row goes and
// the rail's sentence goes with it.
import { openQueue, railText, runNow } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/loose-ends'");
  await page.wait(
    "document.body.innerText.toLowerCase().includes('unfinished reading')",
    15000
  );
  await page.wait(
    "!document.body.innerText.toLowerCase().includes('scout · http')",
    20000
  );
  console.log(
    `LOOSE ENDS: ${await page.eval("document.body.innerText.slice(0, 600)")}`
  );
  await openQueue(page);
  await page.wait("!document.body.innerText.includes('HTTP 503')", 10000);
  await runNow(page, "Overnight benefit");
  await page.sleep(4000);
  console.log(`RAIL: ${await railText(page)}`);
};
