// 2. The first Sync now: asked first, then the scatter, its quadrants, and
// the Tags it cannot place, each with its reason.
import {
  bring,
  chooseTag,
  clickButton,
  editorText,
  expect,
  openMap,
  openPanel,
  panelText,
  points,
} from "./helpers.mjs";
export default async (page) => {
  await openMap(page);
  await openPanel(page);
  await clickButton(page, "Sync now");
  await page.wait(
    `!!document.querySelector('[role=group][aria-label="Confirm sync"]')`
  );
  const asked = await page.eval(
    `document.querySelector('[role=group][aria-label="Confirm sync"]').innerText`
  );
  console.log("ASKED:", asked.replace(/\n+/g, " | "));
  expect(/OpenAlex/.test(asked), "the first Sync now says where it sends");
  await clickButton(page, "Sync");
  await page.wait(`/\\d+ tags? measured/.test(document.body.innerText)`, 60000);
  await page.wait(
    `document.querySelectorAll('[role=option][aria-label*="growth"]').length>=5`,
    30000
  );
  await chooseTag(page, "replay");
  const panel = await panelText(page);
  console.log("PANEL:", panel.replace(/\n+/g, " | "));
  console.log("POINTS:", JSON.stringify(await points(page)));
  for (const name of ["Blind spot", "Crowded", "Obscure", "backwater"])
    expect(panel.includes(name), `the ${name} quadrant is named`);
  expect(
    /axes cross at the median of 5 placed tags/.test(panel),
    "the chart says where its axes cross"
  );
  expect(
    panel.includes("too few papers with text") &&
      panel.includes("too few in the field's index"),
    "each unplaced Tag says why"
  );
  expect(
    !/as of nothing|nothing synced/.test(panel),
    "an as-of date replaced it"
  );
  const editor = await editorText(page, "replay");
  expect(/works in the last 12 months/.test(editor), "the field's counts show");
  await bring(page);
};
