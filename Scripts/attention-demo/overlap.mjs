// 5. The review gains a keyword-overlap candidate: a paper no Tag reaches,
// offered after the shared-Tag ones, with the Terms it holds.
import { expect, openMap } from "./helpers.mjs";
export default async (page) => {
  await openMap(page);
  const options = `[aria-label="Papers sharing a Tag with this question"] [role=option]`;
  await page.wait(
    `document.querySelectorAll(${JSON.stringify(options)}).length>0`
  );
  const rows = await page.eval(
    `[...document.querySelectorAll(${JSON.stringify(options)})].map(o=>o.innerText.replace(/\\n+/g,' | '))`
  );
  console.log("CANDIDATES:", JSON.stringify(rows));
  expect(
    rows.length === 4,
    `three shared-Tag papers and one by keyword: ${rows.length}`
  );
  expect(
    /matches .*hippocampal replay.*sharp wave/.test(rows.at(-1)),
    "the keyword candidate comes last and names the Terms it matches"
  );
  expect(
    !rows.slice(0, -1).some((r) => /matches/.test(r)),
    "the shared-Tag papers do not claim a keyword match"
  );
};
