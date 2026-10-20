// 4. A Scout whose Tag has no Terms: its run fails by name, on the ordinary
// failed-Scout row in Loose Ends, with no other row.
import { expect } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/loose-ends'");
  await page.wait("document.body.innerText.includes('Bare watch')", 20000);
  const text = await page.eval("document.body.innerText");
  expect(/bare has no Terms/.test(text), "the sentence names the Tag");
  console.log(`LOOSE ENDS: ${text.replace(/\n+/g, " | ")}`);
};
