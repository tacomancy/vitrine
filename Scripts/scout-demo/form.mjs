// 1. The creation form, with *try* answered: arXiv's total and its first titles.
import { button, fillNewScout, openQueue } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await fillNewScout(page, {
    name: "Overnight benefit",
    query: "all:overnight AND all:sleep",
  });
  await page.eval(`${button("Try")}.click()`);
  await page.wait(
    "document.body.innerText.includes('results across all of arXiv')",
    15000
  );
  console.log(
    `TRY: ${await page.eval("document.querySelector('form').innerText.slice(0, 400)")}`
  );
};
