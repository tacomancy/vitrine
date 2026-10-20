// 5. Scout Activity shows the Tag Filter as its Tags.
import { NAME, expect } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/scout-activity'");
  await page.wait(
    "!!document.querySelector('table[aria-label=\"Scouts\"]')",
    20000
  );
  const text = await page.eval(
    "document.querySelector('table[aria-label=\"Scouts\"]').innerText"
  );
  expect(
    text.includes(NAME) && text.includes("probing"),
    "the row shows the Tag"
  );
  console.log(`ACTIVITY: ${text.replace(/\n+/g, " | ")}`);
};
