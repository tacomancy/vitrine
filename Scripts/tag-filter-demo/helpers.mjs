// Shared by the drives (docs/agents/run.md).
import { button, openQueue, runNow, railText } from "../scout-demo/helpers.mjs";
export { button, openQueue, runNow, railText };
export {
  chooseTag,
  editorText,
  openPanel,
  setValue,
} from "../attention-demo/helpers.mjs";
export { openMap } from "../question-map-demo/helpers.mjs";

export const NAME = "Probing watch";
export const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

/** New Scout ▸ named ▸ by Tags ▸ the `probing` Tag chosen, its compiled query on the form. */
export async function chooseProbing(page) {
  await openQueue(page);
  await page.eval(`${button("+ New Scout")}.click()`);
  await page.wait("!!document.querySelector('form[aria-label=\"New Scout\"]')");
  await page.type(NAME); // the form focuses Name on mount
  await page.eval(
    `[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='by Tags').querySelector('input').click()`
  );
  await page.wait(
    "[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.includes('probing'))",
    15000
  );
  await page.eval(
    `[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('probing')).click()`
  );
  await page.wait(
    "!!document.querySelector('code[aria-label=\"Compiled query\"]')",
    10000
  );
}
