// Step 2: one PDF returned alone, as from Preview. Its run lands about 7 s
// after the save: 2 s to settle and 5 s of run window.
import { join } from "node:path";
import {
  deliver,
  footerLine,
  name,
  vault,
  waitForQuiet,
  sinceLaunch,
} from "./helpers.mjs";

export default async (page) => {
  await waitForQuiet(page);
  deliver(
    join(vault(), `sources/pdf/${name(1)}.pdf`),
    process.env.DEMO_PDF_RETURNED,
    "returned"
  );
  const saved = Date.now();
  await page.wait("document.body.innerText.includes(' new · ')", 20000);
  const took = Date.now() - saved;
  console.log(`LAUNCH CLOCK: ${sinceLaunch()} ms`);
  console.log(`LONE PDF: ${await footerLine(page)} after ${took} ms`);
  // 7 s plus the page's polling; under 5 s means the window did not wait.
  if (took < 6500 || took > 9000)
    throw new Error(`expected about 7 s, took ${took} ms`);
};
