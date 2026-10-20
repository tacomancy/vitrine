// 7. Changed on disk under unsaved typing is one line; autosave waits.
import {
  expect,
  openFile,
  read,
  settle,
  typeAtEnd,
  write,
} from "./helpers.mjs";
import { READING_LOG } from "./vault.mjs";
export default async (page) => {
  await openFile(page, READING_LOG);
  await typeAtEnd(page, " MINE");
  const elsewhere = `${read(READING_LOG)}\nWritten in Obsidian.\n`;
  write(READING_LOG, elsewhere); // inside the 2 s idle, so the typing is unsaved
  await page.wait("document.body.innerText.includes('changed on disk')", 15000);
  await settle(page);
  expect(
    read(READING_LOG) === elsewhere,
    "autosave paused: the disk copy is untouched"
  );
  console.log(
    `7. LINE: ${await page.eval("[...document.querySelectorAll('[role=status]')].map(s=>s.innerText).find(t=>t.includes('changed on disk'))")}`
  );
};
