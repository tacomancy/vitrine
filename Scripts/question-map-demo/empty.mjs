// 6. The empty vault, read in full.
import { expect, openMap } from "./helpers.mjs";
export default async (page) => {
  await openMap(page);
  await page.wait(
    "/No open questions to map/.test(document.body.innerText)",
    20000
  );
  console.log(
    "EMPTY:",
    await page.eval("document.querySelector('section').innerText.slice(0,300)")
  );
  expect(true, "");
};
