// 5b. The same failure, read from Loose Ends under Broken plumbing; the
// sentence is the rail's, word for word (ADR 0032).
import { openQueue, railText } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await page.wait("document.body.innerText.includes('HTTP 503')", 15000);
  const rail = await railText(page);
  await page.eval("location.hash='#/loose-ends'");
  await page.wait(
    "document.body.innerText.toLowerCase().includes('scout · http')",
    10000
  );
  const loose = await page.eval("document.body.innerText");
  const sentence = /arXiv answered with an error[^\n]*/.exec(rail)?.[0];
  console.log(`SENTENCE: ${sentence}`);
  console.log(
    `SAME SENTENCE IN LOOSE ENDS: ${sentence !== undefined && loose.includes(sentence)}`
  );
  console.log(`LOOSE ENDS: ${loose.slice(0, 900)}`);
};
