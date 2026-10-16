// 5. The weekly line says, in one plain sentence, that it spans two pages.
import { NAME, expect } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/scout-activity'");
  await page.wait(
    "!!document.querySelector('table[aria-label=\"Scouts\"]')",
    20000
  );
  await page.wait(
    `!![...document.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label').startsWith(${JSON.stringify(`${NAME}: accept rate`)}))`,
    20000
  );
  await page.eval(
    `[...document.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label').startsWith(${JSON.stringify(`${NAME}: accept rate`)})).click()`
  );
  await page.sleep(800);
  const text = await page.eval(
    "document.querySelector('table[aria-label=\"Scouts\"]').innerText"
  );
  const sentence =
    /The page last changed on [^\n]*spans more than one page\./.exec(text)?.[0];
  expect(sentence !== undefined, "the line says it spans two pages");
  console.log(`SENTENCE: ${sentence}`);
};
