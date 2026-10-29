// 1. The form: a new Scout of three pages, added one *add another address*
//    at a time (1a), and *try*'s answer for each page under its address with
//    the first look's sum beneath (1b).
// 2. Saved, then *Run now*: the first check reads all three, and the Scouts
//    screen lists every page with nothing wrong on any.
import {
  KEY,
  NAME,
  button,
  expect,
  openQueue,
  openScouts,
  page,
  runAndWait,
  shoot,
  storeKey,
  waitForLines,
} from "./helpers.mjs";

const address = (n) => `input[aria-label="Address ${n}"]`;

export default async (cdp) => {
  // The credential store is the core's memory, so each launch stores it.
  await storeKey(cdp, KEY);
  await cdp.eval(`location.hash = "#/scout-management/new"`);
  await cdp.wait("!!document.querySelector('form[aria-label=\"New Scout\"]')");
  await cdp.type(NAME); // the form focuses Name on mount
  await cdp.eval(`(() => {
    const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='watched'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'watched');
    s.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  const pages = [page("feed"), page("papers"), page("talks")];
  for (const [i, url] of pages.entries()) {
    if (i > 0) {
      await cdp.eval(`${button("add another address")}.click()`);
    }
    await cdp.wait(
      `!!document.querySelector(${JSON.stringify(address(i + 1))})`
    );
    await cdp.eval(
      `document.querySelector(${JSON.stringify(address(i + 1))}).focus()`
    );
    await cdp.type(url);
  }
  await cdp.eval(
    "document.querySelector('input[aria-label=\"Address 1\"]').scrollIntoView({ block: 'center' })"
  );
  await shoot(cdp, "1a-form-addresses");
  await cdp.eval(`${button("Try")}.click()`);
  await cdp.wait(
    "document.querySelector('form').innerText.includes('for the first look at')",
    30000
  );
  await cdp.sleep(500);
  const tried = await cdp.eval(
    "[...document.querySelectorAll('ul[aria-label=\"Pages tried\"] > li')].map(li => li.innerText)"
  );
  console.log(`TRIED: ${JSON.stringify(tried, null, 1)}`);
  expect(tried.length === 3, "try answers each page");
  for (const [i, url] of pages.entries()) {
    expect(tried[i].startsWith(url), `try's answer ${i + 1} is under ${url}`);
  }
  expect(
    /2 found · a feed was found · no model call/.test(tried[0]),
    "the blog is read from its feed, with no model call"
  );
  expect(
    /3 found · 3 verified · 0 dropped/.test(tried[1]) &&
      /3 found · 3 verified · 0 dropped/.test(tried[2]),
    "the papers and talks pages are read by the model, all three verified"
  );
  const form = await cdp.eval("document.querySelector('form').innerText");
  const sum = /≈ \$\d+\.\d\d for the first look at 3 pages/.exec(form);
  expect(sum !== null, "try sums the first look at all three pages");
  console.log(`SUM: ${sum[0]}`);
  await cdp.eval(
    "document.querySelector('ul[aria-label=\"Pages tried\"]').scrollIntoView({ block: 'start' })"
  );
  await shoot(cdp, "1b-form-try");

  await cdp.eval(`${button("Save")}.click()`);
  await cdp.wait("!document.querySelector('form[aria-label=\"New Scout\"]')");
  await openQueue(cdp);
  await runAndWait(cdp, 3);
  await openScouts(cdp);
  const lines = await waitForLines(
    cdp,
    (lines) =>
      lines.length === 3 && lines.every((l, i) => l.trim() === pages[i]),
    "the first check leaves every page with nothing to say: each found something"
  );
  console.log(`PAGES: ${JSON.stringify(lines)}`);
  await shoot(cdp, "2-first-check");
};
