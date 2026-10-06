// 3. Depth 1: the matrix and the readings move together. QM_DEPTH_STEP is
// `before` (the default depth) or `after` (depth 1, clicked).
import {
  button,
  expect,
  gridSize,
  openMapRead,
  readingButtons,
  stated,
} from "./helpers.mjs";
const snap = async (page) => ({
  stated: await stated(page),
  grid: await gridSize(page),
  readings: await readingButtons(page),
});
export default async (page) => {
  await openMapRead(page);
  const before = await snap(page);
  console.log("DEPTH default:", JSON.stringify(before));
  if (process.env.QM_DEPTH_STEP === "before") return;
  await page.eval(`${button("1")}.click()`);
  await page.wait(
    `document.querySelector('[role=group][aria-label=Depth] [aria-pressed=true]').textContent==='1'`
  );
  await page.wait(
    `!!document.querySelector('[role=grid]') && document.querySelectorAll('[role=columnheader]').length !== ${before.grid.columns}`
  );
  await page.wait(
    `document.querySelectorAll('[data-slot=readings] section > button').length > 0`
  );
  const after = await snap(page);
  console.log("DEPTH 1:", JSON.stringify(after));
  expect(
    after.grid.columns < before.grid.columns,
    "depth 1 rolls the columns up"
  );
  expect(after.stated !== before.stated, "the stated line follows the depth");
  expect(
    JSON.stringify(after.readings) !== JSON.stringify(before.readings),
    "the readings move with the matrix"
  );
};
