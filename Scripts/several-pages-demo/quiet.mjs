// 3. The second check, a day later on the site: the blog and the papers page
//    list new work, the talks page lists what it did. The talks page reads as
//    a Quiet field on its own line, with its Warrant, while its siblings find.
// 4. Their new finds triaged in Review, then the Scout's row opened: the
//    Accept rate by page and the cost per run by page, and *each run* listing
//    the checks with their pages beneath.
import { NEW_AT } from "./standin.mjs";
import {
  KEY,
  NAME,
  expect,
  openQueue,
  openScouts,
  page,
  press,
  runAndWait,
  scoutHeader,
  shoot,
  storeKey,
  waitForLines,
} from "./helpers.mjs";

const byLabel = (label) =>
  `[...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label').startsWith(${JSON.stringify(label)}))`;

/** A new find chosen in Review and judged by its key; the footer says the act. */
async function judge(cdp, title, letter, said) {
  const row = `document.querySelector(${JSON.stringify(`[aria-label="New finds"] li button[aria-label=${JSON.stringify(title)}]`)})`;
  await cdp.wait(`!!${row}`, 15000);
  await cdp.eval(`${row}.click()`);
  await cdp.wait(
    `document.querySelector('[aria-current="true"]')?.getAttribute('aria-label') === ${JSON.stringify(title)}`,
    5000
  );
  await press(cdp, letter);
  await cdp.wait(
    `document.body.innerText.includes(${JSON.stringify(said)})`,
    8000
  );
  await cdp.sleep(500);
}

export default async (cdp) => {
  await storeKey(cdp, KEY);
  await openQueue(cdp);
  await runAndWait(cdp, 3);
  await openScouts(cdp);
  const lines = await waitForLines(
    cdp,
    (l) =>
      l.length === 3 &&
      l[0].trim() === page("feed") &&
      l[1].trim() === page("papers") &&
      /parsed cleanly/.test(l[2]),
    "the talks page goes quiet on its own line while the others find"
  );
  console.log(`PAGES: ${JSON.stringify(lines)}`);
  const voice = await scoutHeader(cdp);
  expect(
    !/parsed cleanly/.test(voice),
    "the Quiet field is the page's, never the Scout's header"
  );
  await shoot(cdp, "3-quiet-page");

  await openQueue(cdp);
  await judge(cdp, NEW_AT(2).papers[0], "a", "Accepted into");
  await judge(cdp, NEW_AT(2).papers[1], "a", "Accepted into");
  await judge(cdp, NEW_AT(2).papers[2], "r", "Rejected “");
  await judge(cdp, NEW_AT(2).feed[0], "a", "Accepted into");

  await openScouts(cdp);
  await cdp.eval(`${byLabel(`${NAME}: accept rate,`)}.click()`);
  await cdp.wait(`!!${byLabel(`${NAME}: accept rate by page`)}`, 10000);
  await cdp.eval(`${byLabel(`${NAME}: each run`)}.click()`);
  await cdp.wait(
    `!!document.querySelector('[aria-label="${NAME} runs"]')`,
    10000
  );
  await cdp.sleep(800);
  const list = (label) =>
    cdp.eval(
      `[...document.querySelectorAll(${JSON.stringify(`[aria-label="${label}"] > li`)})].map(li => li.innerText)`
    );
  const rates = await list(`${NAME}: accept rate by page`);
  const costs = await list(`${NAME}: cost per run, by page`);
  const checks = await list(`${NAME} runs`);
  console.log(`RATES: ${JSON.stringify(rates, null, 1)}`);
  console.log(`COSTS: ${JSON.stringify(costs, null, 1)}`);
  console.log(`CHECKS: ${JSON.stringify(checks, null, 1)}`);
  expect(
    rates.length === 3 &&
      /without venue/.test(rates[0]) &&
      /67% · 3 triaged/.test(rates[1]) &&
      /nothing triaged yet/.test(rates[2]),
    "each page's rate, guarded apart: the feed's posts carry no venue"
  );
  expect(
    costs.length === 3 &&
      /no model call/.test(costs[0]) &&
      /\$[\d.]+ · 2 runs/.test(costs[1]) &&
      /\$[\d.]+ · 1 run\b/.test(costs[2]),
    "each page's mean cost per run; the talks page's unchanged listing cost nothing to look at again"
  );
  expect(checks.length === 2, "each run lists the two checks");
  await cdp.eval(
    `document.querySelector('[aria-label="${NAME}: accept rate by page"]').scrollIntoView({ block: 'center' })`
  );
  await shoot(cdp, "4-accept-rate-and-cost");
};
