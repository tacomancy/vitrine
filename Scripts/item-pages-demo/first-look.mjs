// 1. The form's *try* on the alignment listing: the first titles, the
//    projection for the first look, and the three cards it read.
// 2. Saved and run: the first look's card for an item whose page names its
//    paper, filled with its date, summary, authors and *paper*.
// 3a. An item past the 25 Item pages, Listing-only: its fields missing.
import {
  NAME,
  REWARD,
  TRACING,
  button,
  chooseInBatch,
  expect,
  fillPageScout,
  openQueue,
  runNow,
  saveScout,
  shoot,
  storeKey,
} from "./helpers.mjs";

export default async (page) => {
  // The credential store is the core's memory, so each launch stores it.
  await storeKey(page, "sk-demo-good");
  await openQueue(page);
  await fillPageScout(page, { name: NAME, path: "/research/team/alignment" });
  await page.eval(`${button("Try")}.click()`);
  await page.wait(
    "document.querySelector('form').innerText.includes('≈')",
    30000
  );
  await page.sleep(500);
  const form = await page.eval("document.querySelector('form').innerText");
  console.log(`FORM: ${form}`);
  expect(
    /≈ \$\d+\.\d\d for 28 item pages/.test(form),
    "try projects the first look over the 28 items on the listing's site"
  );
  expect(
    form.includes("Lindsey, Jack") && form.includes("Lynch, Aengus"),
    "try shows the cards its three Item pages filled"
  );
  await shoot(page, "1-try-projection");

  await saveScout(page);
  await openQueue(page);
  await runNow(page, NAME);
  const card = await chooseInBatch(page, TRACING);
  console.log(`CARD: ${card}`);
  for (const value of [
    "Lindsey, Jack, Gurnee, Wes",
    "2025-03-27",
    "Today we are sharing two new papers on the biology of a large language model.",
    "https://transformer-circuits.pub/2025/attribution-graphs/biology.html",
  ]) {
    expect(card.includes(value), `the filled card carries ${value}`);
  }
  expect(/\npaper\n/.test(card), "the card labels its Paper link *paper*");
  expect(
    !card.includes("This builds on"),
    "nothing cited on the page stands in for the paper"
  );
  await shoot(page, "2-card-with-paper");

  const before = await chooseInBatch(page, REWARD);
  console.log(`LISTING-ONLY: ${before}`);
  expect(
    /authors\nmissing/.test(before) && /published\nmissing/.test(before),
    "the 28th item's page is not read on the first look"
  );
  await shoot(page, "3a-listing-only");
};
