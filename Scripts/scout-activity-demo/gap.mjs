// 7. A coverage gap read through to *brief a scout*: the form opens with that
// Question already Assigned.
import { click, expect, openActivity } from "./helpers.mjs";
const NAPS = "Is a nap enough to consolidate?";
export default async (page) => {
  await openActivity(page);
  const gaps = await page.eval(
    "document.querySelector('section[aria-labelledby]:not([class*=page])')?.innerText ?? document.body.innerText"
  );
  console.log(`GAPS: ${gaps.replace(/\s+/g, " ").slice(0, 600)}`);
  await click(page, `brief a scout: ${NAPS}`);
  await page.wait(
    "!!document.querySelector('form[aria-label=\"New Scout\"]')",
    15000
  );
  await page.sleep(1000);
  const form = await page.eval(
    "document.querySelector('form[aria-label=\"New Scout\"]').innerText"
  );
  console.log(`FORM: ${form.replace(/\s+/g, " ")}`);
  const assigned = await page.eval(
    "[...document.querySelectorAll('form[aria-label=\"New Scout\"] input[type=checkbox]:checked')].map(c=>c.closest('label').innerText.trim())"
  );
  console.log(`ASSIGNED: ${JSON.stringify(assigned)}`);
  expect(
    assigned.length === 1 && assigned[0].includes(NAPS),
    "the gap's Question, and only it, is already Assigned on the form"
  );
};
