// 1a. The form: a Tag chosen, its Terms and the compiled arXiv query verbatim,
// and *try* answered. Nothing is saved.
import { button, chooseProbing, expect } from "./helpers.mjs";
export default async (page) => {
  await chooseProbing(page);
  await page.eval(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('probing — Terms')).click()`
  );
  await page.eval(`${button("Try")}.click()`);
  await page.wait(
    "document.body.innerText.includes('results across all of arXiv')",
    15000
  );
  const compiled = await page.eval(
    "document.querySelector('code[aria-label=\"Compiled query\"]').textContent"
  );
  expect(compiled.includes('abs:"linear probe"'), "the query holds the Term");
  console.log(`COMPILED: ${compiled}`);
};
