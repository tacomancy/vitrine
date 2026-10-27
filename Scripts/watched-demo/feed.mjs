// 1. A page that advertises a feed: read from the feed, no model, no cost.
import {
  chooseFirstLook,
  fillPageScout,
  openQueue,
  railText,
  runNow,
  saveScout,
} from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await fillPageScout(page, { name: "Lab feed", path: "/feed-lab/" });
  await saveScout(page);
  await runNow(page, "Lab feed");
  await chooseFirstLook(page, "Lab feed");
  console.log(`RAIL: ${await railText(page)}`);
};
