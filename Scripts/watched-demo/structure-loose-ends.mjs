// 5b. The structure-change row under Broken plumbing: one row, three actions,
// the rail's sentence word for word.
import { openQueue, railText } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await page.wait(
    "document.body.innerText.includes('its structure changed')",
    15000
  );
  const rail = await railText(page);
  await page.eval("location.hash='#/loose-ends'");
  await page.wait(
    "document.body.innerText.includes('its structure changed')",
    10000
  );
  const text = await page.eval("document.body.innerText");
  const sentence = /[^\n]*its structure changed[^\n]*/
    .exec(rail)?.[0]
    ?.replace(/^⚠\s*/, "");
  if (sentence === undefined || !text.includes(sentence))
    throw new Error("Loose Ends does not carry the rail's sentence");
  for (const action of ["open the page", "run now", "pause"])
    if (!text.toLowerCase().includes(action))
      throw new Error(`the structure row lacks *${action}*`);
  if ((text.match(/its structure changed/g) ?? []).length !== 1)
    throw new Error("the structure change is not exactly one row");
  console.log(`SENTENCE: ${sentence}`);
  console.log(`LOOSE ENDS: ${text.slice(0, 900)}`);
};
