// 7a. The budget is low (under the sync's reserve of 300): the scatter's sync
// stops after the first answer and says it paused to leave room for Scouts.
import { budget, expect, openMap } from "./helpers.mjs";
export default async (page) => {
  await budget("low");
  await openMap(page);
  const attention =
    "document.querySelector('section[aria-labelledby=attention-title]')";
  await page.wait(`!!${attention}?.querySelector('button')`, 30000);
  await page.eval(
    `[...${attention}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sync now').click()`
  );
  await page.wait(
    "!!document.querySelector('[role=group][aria-label=\"Confirm sync\"]')"
  );
  await page.eval(
    `[...${attention}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sync').click()`
  );
  await page.wait(
    "document.body.innerText.includes('paused to leave room for Scouts')",
    60000
  );
  await page.eval(`${attention}.scrollIntoView({ block: "start" })`);
  const text = await page.eval(`${attention}.innerText`);
  console.log(`PANEL: ${text.replace(/\n+/g, " | ")}`);
  expect(/resumes after the reset/.test(text), "it says it resumes");
};
