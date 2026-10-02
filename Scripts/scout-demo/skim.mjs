// 3. A second Scout whose Lane is Skim; its papers are a feed, not a stack.
import { button, fillNewScout, openQueue, runNow } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await fillNewScout(page, {
    name: "Replay",
    query: "all:replay",
    lane: "skim",
  });
  await page.eval(`${button("Save")}.click()`);
  await page.wait("!document.querySelector('form[aria-label=\"New Scout\"]')");
  await runNow(page, "Replay");
  await page.eval(`${button("Skim")}.click()`);
  await page.wait(
    "!!document.querySelector('ul[aria-label=\"Skim\"] li')",
    20000
  );
  console.log(
    `SKIM: ${await page.eval("document.querySelector('ul[aria-label=\"Skim\"]').innerText")}`
  );
};
