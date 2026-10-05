// 2. A page with no feed and no key yet: *try* says so and offers Settings;
// the Scout saves without running; *run now* says *not yet*, with the reason.
import {
  button,
  fillPageScout,
  openQueue,
  railText,
  runNow,
  saveScout,
} from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await fillPageScout(page, { name: "Lab page", path: "/lab/" });
  await page.eval(`${button("Try")}.click()`);
  await page.wait(`!!${button("Add a key")}`, 10000);
  console.log(
    `TRY: ${await page.eval("document.querySelector('form').innerText")}`
  );
  await saveScout(page);
  await runNow(page, "Lab page");
  await page.wait(
    "(document.querySelector('ul[aria-label=\"Scouts\"]')?.innerText ?? '').toLowerCase().includes('not yet')",
    15000
  );
  console.log(`RAIL: ${await railText(page)}`);
};
