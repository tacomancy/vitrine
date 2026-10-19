// 4. The sync a vault runs on open fails for the pending Tag. It keeps its
// measurement and says so; Loose Ends and the Inbox carry nothing of it.
import { readFileSync } from "node:fs";
import {
  bring,
  expect,
  quiet,
  openMap,
  openPanel,
  panelText,
  points,
} from "./helpers.mjs";
export default async (page) => {
  await openMap(page);
  await openPanel(page);
  await page.wait(
    `/OpenAlex answered with an error, kept its measurement as of/.test(document.body.innerText)`,
    60000
  );
  const panel = await panelText(page);
  console.log("PANEL:", panel.replace(/\n+/g, " | "));
  expect(
    /engrams: OpenAlex answered with an error, kept its measurement as of \d{4}-\d{2}-\d{2}/.test(
      panel
    ),
    "the failure names the Tag and the date it kept"
  );
  expect(
    panel.includes("re-measure pending"),
    "the Tag is still marked pending"
  );
  expect(
    (await points(page)).some((p) => /^engrams:.*re-measure pending/.test(p)),
    "its last point is still plotted"
  );

  // The beat adds no Loose Ends row and no Home item (spec #636): the pages
  // say what they said before anything was measured, with a Tag unsynced
  // then, and now a pending one, a failed one and two unplaced.
  const now = await quiet(page);
  const was = JSON.parse(readFileSync(process.env.AD_BASELINE, "utf8"));
  for (const hash of Object.keys(was)) {
    console.log(
      `TEXT ${hash}:`,
      now[hash].replace(/\n+/g, " | ").slice(0, 300)
    );
    expect(now[hash] === was[hash], `${hash} is as it was before the scatter`);
  }
  await page.eval("location.hash='#/question-map'");
  await openPanel(page);
  await bring(page);
};
