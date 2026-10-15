// 5a. Drop from the row: it stays in place, saying what happened, with undo.
import { click, expect, openActivity, present } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page);
  await click(page, "Stale topic: drop");
  await page.wait("document.body.innerText.includes('no longer runs')", 10000);
  expect(
    await page.eval(
      "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='undo')"
    ),
    "the row offers undo while it is on screen"
  );
  expect(
    !(await present(page, "Stale topic: drop")),
    "the row's own actions have gone"
  );
  console.log("DROPPED: row stays, says it no longer runs, offers undo");
};
