// 2. An OpenAlex Scout by Tags: the Tag chosen, its compiled query verbatim on
// the form, Try answered; then saved.
import { expect, newOpenAlexScout, save, tryIt } from "./helpers.mjs";
export default async (page) => {
  await newOpenAlexScout(page, "Probing by Tags");
  await page.eval(
    `[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='by Tags').querySelector('input').click()`
  );
  await page.wait(
    "[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.includes('probing'))",
    15000
  );
  await page.eval(
    `[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('probing')).click()`
  );
  await page.wait(
    "!!document.querySelector('code[aria-label=\"Compiled query\"]')",
    10000
  );
  const compiled = await page.eval(
    "document.querySelector('code[aria-label=\"Compiled query\"]').textContent"
  );
  expect(
    compiled.includes('"linear probe"'),
    `the query holds the Term, got ${compiled}`
  );
  console.log(`COMPILED: ${compiled}`);
  await tryIt(page, "results across journals and conferences in OpenAlex");
  await save(page);
};
