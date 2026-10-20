// 1b. Saved, then run: arXiv is asked for the Tag's compiled query inside the
// run's window. A new Scout waits for its first check; Run now is that check.
import {
  button,
  chooseProbing,
  expect,
  openQueue,
  railText,
  runNow,
  NAME,
} from "./helpers.mjs";
export default async (page) => {
  await chooseProbing(page);
  await page.eval(`${button("Save")}.click()`);
  await page.wait(
    "!document.querySelector('form[aria-label=\"New Scout\"]')",
    10000
  );
  await openQueue(page);
  await runNow(page, NAME);
  await page.sleep(6000);
  const rail = await railText(page);
  expect(rail.includes(NAME), "the Scout is on the rail");
  console.log(`RAIL: ${rail}`);
};
