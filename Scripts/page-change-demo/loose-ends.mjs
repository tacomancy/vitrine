// 4b. Loose Ends after the move: no row for the old page's 404 and no
// *structure changed* for a page the researcher chose.
import { NAME, expect } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/loose-ends'");
  await page.wait("document.body.innerText.length > 100", 10000);
  await page.sleep(1500);
  const text = await page.eval("document.body.innerText");
  expect(!text.includes("404"), "the old page's failure is on no row");
  expect(!text.includes("structure changed"), "no structure-change row");
  expect(!text.includes(`${NAME} · failed`), "no fault row for the Scout");
  console.log(`LOOSE ENDS: ${text.slice(0, 900)}`);
};
