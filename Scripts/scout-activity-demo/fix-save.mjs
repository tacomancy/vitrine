// 3b. Saved from the row: the Scout runs at once, and the row says so.
import { click, expect, openActivity, setValue } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page);
  await click(page, "Dream reports: edit");
  await page.wait(
    "!!document.querySelector('form[aria-label=\"Edit Dream reports\"] textarea')"
  );
  await page.eval(setValue("form textarea", "all:dream AND cat:q-bio.NC"));
  await page.eval(
    "[...document.querySelectorAll('form button')].find(b=>b.textContent==='Save').click()"
  );
  await page.wait("document.body.innerText.includes('Saved.')", 20000);
  const said = await page.eval(
    "[...document.querySelectorAll('[role=status]')].map(e=>e.innerText).find(t=>t.startsWith('Saved'))"
  );
  console.log(`SAVED: ${said}`);
  expect(said.includes("ran at once"), "saving a Query runs the Scout");
};
