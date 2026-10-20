// 9. Following links from the editor: a Source lands on its own surface; an
// unresolved link says so; a scheme Vitrine will not follow says which.
import { expect, openFile } from "./helpers.mjs";
import { LINKS_NOTE } from "./vault.mjs";
const word = (page, sel) =>
  page.eval(
    `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.click(); return el.textContent; })()`
  );
export default async (page) => {
  await openFile(page, LINKS_NOTE);
  await page.wait(
    "!!document.querySelector('[data-link=\"rasch2013\"]')",
    15000
  );
  await word(page, '[data-link="rasch2013"]');
  await page.wait("!location.hash.startsWith('#/vault')", 10000);
  const landed = await page.eval("location.hash");
  console.log(`9a. [[rasch2013]] LANDED: ${landed}`);
  expect(
    landed === "#/source/sources/rasch2013.md",
    "a Source lands on its own surface"
  );

  await openFile(page, LINKS_NOTE);
  await word(page, '[data-link="never written"]');
  await page.wait(
    "document.body.innerText.includes('has no file in this vault')",
    10000
  );
  await word(page, '[data-href^="file:"]');
  await page.wait(
    "[...document.querySelectorAll('[role=alert]')].some(a=>/will not follow file/.test(a.innerText))",
    10000
  );
  console.log(
    `9b. REFUSAL: ${await page.eval("[...document.querySelectorAll('[role=alert], [role=status]')].map(e=>e.innerText).join(' | ')")}`
  );
  expect(
    (await page.eval("location.hash")).startsWith("#/vault"),
    "a refused scheme left the app where it was"
  );
};
