// 5. The Map caught while the vault is still being read: *not yet*, never
// *nothing to map*.
import { expect } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/question-map'");
  await page.wait("!!document.querySelector('#question-map-title')");
  const text = await page.eval("document.body.innerText");
  console.log("NOT YET:", JSON.stringify(text.slice(0, 400)));
  expect(
    !/No open questions to map/.test(text),
    "a build never reads as an empty vault"
  );
  expect(
    /not read yet|reading the vault/i.test(text),
    "the page says it has not looked yet"
  );
};
