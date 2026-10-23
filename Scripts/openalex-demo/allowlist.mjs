// 3. A venue allowlist: a name search that finds two near-identical venues,
// told apart by publisher, ISSN and works count; one added; Try then asks only
// that venue. Saved.
import {
  button,
  expect,
  newOpenAlexScout,
  save,
  tryIt,
  typeQuery,
} from "./helpers.mjs";
export default async (page) => {
  await newOpenAlexScout(page, "Interpretability only");
  await typeQuery(page, "probe");
  await tryIt(page, "results across journals and conferences in OpenAlex");
  const all = await page.eval("document.body.innerText");
  expect(/4 results across/.test(all), "without a list, every venue answers");
  await page.eval(
    `(() => {
      const el=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Venue name')).control ?? document.querySelector('input[type=text]:not([disabled])');
      el.focus();
    })()`
  );
  await page.type("Interpretability");
  await page.eval(`${button("Search venues")}.click()`);
  await page.wait(
    "!!document.querySelector('ul[aria-label=\"Venue results\"]')",
    15000
  );
  const results = await page.eval(
    "document.querySelector('ul[aria-label=\"Venue results\"]').innerText"
  );
  console.log(`RESULTS: ${results.replace(/\n+/g, " | ")}`);
  expect(
    results.includes("ISSN 2001-0001") && results.includes("ISSN 2001-0099"),
    "two near-duplicates are told apart by ISSN"
  );
  await page.eval(
    `document.querySelector('button[aria-label^="Add Journal of Interpretability ("]').click()`
  );
  await page.wait(
    "!!document.querySelector('ul[aria-label=\"Allowed venues\"]')"
  );
  await tryIt(page, "results across");
  const narrowed = await page.eval("document.body.innerText");
  expect(
    /(^|\D)1 results across/.test(narrowed),
    "Try asks only the allowed venue, and one work answers"
  );
  await save(page);
};
