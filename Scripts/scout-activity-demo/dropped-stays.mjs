// 5b. After a relaunch: gone from the table, one quiet line at the foot, and
// its Proposals still in Review under its name — none rejected for it.
import { expect, names, openActivity } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page, 11);
  expect(!(await names(page)).includes("Stale topic"), "it has left the table");
  const line = await page.eval(
    "[...document.querySelectorAll('button')].find(b=>/\\d+ dropped/.test(b.textContent))?.textContent"
  );
  expect(line === "1 dropped", `the foot says 1 dropped, not ${line}`);
  await page.eval("location.hash='#/scouts?scout=stale-topic'");
  await page.wait(
    "document.body.innerText.includes('what it found stays in Review')",
    15000
  );
  const text = await page.eval("document.body.innerText");
  expect(
    text.includes("Stale topic"),
    "its stack is still in the Queue under its name"
  );
  expect(!text.includes("nothing waiting"), "its Proposals are still waiting");
  const rail = await page.eval(
    "document.querySelector('ul[aria-label=\"Scouts\"]')?.innerText ?? null"
  );
  expect(rail !== null, "the rail is on the screen to be read");
  expect(!rail.includes("Stale topic"), "the rail lists only Scouts that look");
  console.log(
    `QUEUE: ${(await page.eval("document.querySelector('[aria-label=\"Scout Queue\"]').innerText")).replace(/\s+/g, " ").slice(0, 500)}`
  );
};
