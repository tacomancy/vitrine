// 3b. The next run reads the Listing-only item's page: the same card, still
//     pending, gains its authors, date and summary. Then the filled card with
//     a Paper link is accepted, and the script reads its stub.
import {
  NAME,
  REWARD,
  TRACING,
  chooseInBatch,
  expect,
  openQueue,
  press,
  runNow,
  shoot,
  storeKey,
} from "./helpers.mjs";

export default async (page) => {
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await runNow(page, NAME);
  // The Queue re-reads when the run finishes, so the open card fills in place.
  await chooseInBatch(page, REWARD);
  await page.wait(
    `document.querySelector('article[aria-label=${JSON.stringify(REWARD)}]').innerText.includes('Monte MacDiarmid')`,
    30000
  );
  const after = await chooseInBatch(page, REWARD);
  console.log(`FILLED: ${after}`);
  for (const value of [
    "Monte MacDiarmid, Evan Hubinger",
    "2025-11-21",
    "We show that learning to reward hack",
  ]) {
    expect(after.includes(value), `the Listing-only card gains ${value}`);
  }
  expect(!after.includes("Anthropic,"), "the organisation is not an author");
  await shoot(page, "3b-listing-only-filled");

  await chooseInBatch(page, TRACING);
  await press(page, "a");
  await page.sleep(1500);
};
