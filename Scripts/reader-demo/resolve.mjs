// Step 2: the Preview re-save removed three highlights that notes link to.
// Ingest could not find them, so each is an Unmatched row in Loose Ends; the
// three are resolved the three ways — relink, drop the links, treat as new.
export default async (page) => {
  await page.eval("location.hash='#/loose-ends'");
  const click = (label, nth = 0) =>
    page.eval(
      `[...document.querySelectorAll('button')].filter(b=>b.textContent==='${label}')[${nth}].click()`
    );
  const rowsText = () => page.eval("document.body.innerText");
  await page.wait(
    "document.body.innerText.includes('annotation · unmatched')",
    20000
  );
  console.log(
    `BEFORE: ${(await rowsText()).split("UNFINISHED")[0].slice(-1600)}`
  );
  // Rows come in page order: p.1 spindles, p.1 cue, p.2 sentence.
  await click("relink", 1);
  await page.wait(
    "!!document.querySelector('[aria-label=\"relink to\"] button')"
  );
  await page.eval(
    "document.querySelector('[aria-label=\"relink to\"] button').click()"
  );
  await page.sleep(1500);
  await click("drop the links", 0);
  await page.sleep(1500);
  await click("treat as new", 0);
  await page.sleep(2000);
  console.log(`AFTER: ${(await rowsText()).slice(-1800)}`);
};
