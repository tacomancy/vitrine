// Shared by the drives (docs/agents/run.md).
import { button, openQueue, railText, runNow } from "../scout-demo/helpers.mjs";
export { button, openQueue, railText, runNow };
export { expect } from "../scout-activity-demo/helpers.mjs";
export { openMap } from "../question-map-demo/helpers.mjs";
export { setValue } from "../attention-demo/helpers.mjs";

/** A value set the way a person's choice sets it, for React to see. */
export const select = (page, optionValue) =>
  page.eval(`(() => {
    const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===${JSON.stringify(optionValue)}));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(optionValue)});
    s.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);

/** + New Scout ▸ named ▸ watching OpenAlex. */
export async function newOpenAlexScout(page, name) {
  await openQueue(page);
  await page.eval(`${button("+ New Scout")}.click()`);
  await page.wait("!!document.querySelector('form[aria-label=\"New Scout\"]')");
  await page.type(name); // the form focuses Name on mount
  await select(page, "openalex");
}

/** The Query field, typed. */
export async function typeQuery(page, query) {
  await page.eval("document.querySelector('textarea').focus()");
  await page.type(query);
}

/** Try, and wait for the sentence it ends in. */
export async function tryIt(page, until) {
  await page.eval(`${button("Try")}.click()`);
  await page.wait(
    `document.body.innerText.includes(${JSON.stringify(until)})`,
    15000
  );
}

export async function save(page) {
  await page.eval(`${button("Save")}.click()`);
  await page.wait(
    "!document.querySelector('form[aria-label=\"New Scout\"]')",
    10000
  );
}

/** Set the budget the stand-in answers with: `open`, `low` (under the sync's reserve) or `spent`. */
export const budget = (mode) =>
  fetch(`${process.env.DEMO_STANDIN}/__budget?mode=${mode}`);
