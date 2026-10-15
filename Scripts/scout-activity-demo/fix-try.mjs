// 3a. Its Query edited in the row, and the dry run says what would change.
import { click, expect, openActivity, setValue } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page);
  await click(page, "Dream reports: edit");
  await page.wait(
    "!!document.querySelector('form[aria-label=\"Edit Dream reports\"] textarea')"
  );
  await page.eval(setValue("form textarea", "all:dream AND cat:q-bio.NC"));
  await page.eval(
    "[...document.querySelectorAll('form button')].find(b=>b.textContent.startsWith('Try over')).click()"
  );
  await page.wait(
    "document.body.innerText.includes('that run fetched')",
    15000
  );
  const said = await page.eval(
    "document.querySelector('form[aria-label=\"Edit Dream reports\"] [role=status]').innerText"
  );
  console.log(`TRY: ${said}`);
  expect(
    said.includes("matches 1") && said.includes("fetched 40"),
    "the dry run names both totals"
  );
};
