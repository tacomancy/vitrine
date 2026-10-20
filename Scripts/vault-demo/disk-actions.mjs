// 8. The line's two actions, and a clean editor reloading silently.
import {
  button,
  expect,
  openFile,
  read,
  settle,
  typeAtEnd,
  write,
} from "./helpers.mjs";
import { READING_LOG } from "./vault.mjs";
const shown = (page) =>
  page.wait("document.body.innerText.includes('changed on disk')", 15000);
export default async (page) => {
  await openFile(page, READING_LOG);
  await typeAtEnd(page, " KEPT");
  write(READING_LOG, `${read(READING_LOG)}\nFirst outside edit.\n`);
  await shown(page);
  await page.eval(`${button("keep mine")}.click()`);
  await settle(page);
  expect(
    read(READING_LOG).includes("KEPT"),
    "keep mine saved my typing over the disk copy"
  );

  await typeAtEnd(page, " LOST");
  const theirs = `${read(READING_LOG).replace(" LOST", "")}\nSecond outside edit.\n`;
  write(READING_LOG, theirs);
  await shown(page);
  await page.eval(`${button("take the disk copy")}.click()`);
  await page.wait(
    "!document.querySelector('.cm-content').innerText.includes('LOST')",
    10000
  );
  await settle(page);
  expect(read(READING_LOG) === theirs, "taking the disk copy wrote nothing");

  // Nothing unsaved now: the next change reloads without a line.
  write(READING_LOG, `${theirs}Third, to a clean editor.\n`);
  await page.wait(
    "document.querySelector('.cm-content').innerText.includes('Third, to a clean editor')",
    15000
  );
  expect(
    !(await page.eval("document.body.innerText.includes('changed on disk')")),
    "a clean editor reloads silently"
  );
};
