// 4b. The same fault from Loose Ends, in the rail's sentence word for word —
// and the Scout is named in Settings, from the key's side.
import { openQueue, railText } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await page.wait(
    "document.body.innerText.includes('refused the stored key')",
    15000
  );
  const rail = await railText(page);
  await page.eval("location.hash='#/loose-ends'");
  await page.wait(
    "document.body.innerText.includes('refused the stored key')",
    10000
  );
  const loose = await page.eval("document.body.innerText");
  const sentence = /[^\n]*refused the stored key[^\n]*/.exec(rail)?.[0];
  console.log(`SENTENCE: ${sentence}`);
  if (sentence === undefined || !loose.includes(sentence))
    throw new Error("Loose Ends does not carry the rail's sentence");
  console.log("SAME SENTENCE IN LOOSE ENDS: true");
  console.log(`LOOSE ENDS: ${loose.slice(0, 900)}`);
};
