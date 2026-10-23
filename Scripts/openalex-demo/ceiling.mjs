// 6. The ceiling: a broad Query matches 650 works; a run keeps 400 and says
// how many more matched, so a cut cannot pass for a quiet field.
import { expect, openQueue, runNow } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await runNow(page, "Broad watch");
  await page.wait("document.body.innerText.includes('stopped at 400')", 60000);
  const said = await page.eval("document.body.innerText");
  expect(
    said.includes("stopped at 400 — 250 more matched"),
    "the run says what it left"
  );
};
