// 2. The Scout is saved and run; the Review stack has a card in hand.
import { button, fillNewScout, openQueue, runNow } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await fillNewScout(page, {
    name: "Overnight benefit",
    query: "all:overnight AND all:sleep",
  });
  // Assign it to the first open Question the form offers, if any.
  await page.eval(
    "document.querySelector('fieldset input[type=checkbox]')?.click()"
  );
  await page.eval(`${button("Save")}.click()`);
  await page.wait("!document.querySelector('form[aria-label=\"New Scout\"]')");
  await runNow(page, "Overnight benefit");
  await page.wait("!!document.querySelector('article[aria-label]')", 20000);
  console.log(
    `REVIEW: ${await page.eval("document.querySelector('[aria-label=\"Scout Queue\"]').innerText.slice(0, 700)")}`
  );
};
