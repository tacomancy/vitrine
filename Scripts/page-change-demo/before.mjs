// 1. The Scout watches the lab's page and has read it: one run, five Proposals
// accepted, so its Accept rate has something to say.
import {
  NAME,
  storeKey,
  expect,
  fillPageScout,
  openQueue,
  press,
  railText,
  runNow,
  saveScout,
} from "./helpers.mjs";
export default async (page) => {
  // The credential store is the core's memory, so each launch that reads a
  // page stores the key again.
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await fillPageScout(page, { name: NAME, path: "/old/" });
  await saveScout(page);
  await runNow(page, NAME);
  await page.wait("!!document.querySelector('article[aria-label]')", 20000);
  // The weekly line is drawn once a week holds five triaged items.
  for (let i = 0; i < 5; i++) {
    await press(page, "a");
    await page.sleep(400);
  }
  const rail = await railText(page);
  expect(rail.includes(NAME), "the Scout is on the rail");
  console.log(`RAIL: ${rail}`);
};
