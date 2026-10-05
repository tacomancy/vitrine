// 1. A page that advertises a feed: read from the feed, no model, no cost.
import {
  fillPageScout,
  openQueue,
  rail,
  runNow,
  saveScout,
} from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await fillPageScout(page, { name: "Lab feed", path: "/feed-lab/" });
  await saveScout(page);
  await runNow(page, "Lab feed");
  await page.wait("!!document.querySelector('article[aria-label]')", 20000);
  console.log(`RAIL: ${await rail(page)}`);
};
