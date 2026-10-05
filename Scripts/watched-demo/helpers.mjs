// Shared by the drives (docs/agents/run.md). The stand-in's origin arrives in
// the environment of the launching script, which a drive runs inside.
import { button, openQueue, railText, runNow } from "../scout-demo/helpers.mjs";
export { button, openQueue, railText, runNow };

export const origin = () => process.env.DEMO_ORIGIN;

const setSelect = (value) => `(() => {
  const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='${value}'));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${value}');
  s.dispatchEvent(new Event('change',{bubbles:true}));
})()`;

/** The form for a Scout that watches a web page, filled and not yet saved. */
export async function fillPageScout(page, { name, path }) {
  await page.eval(`${button("+ New Scout")}.click()`);
  await page.wait("!!document.querySelector('form[aria-label=\"New Scout\"]')");
  await page.type(name);
  await page.eval(setSelect("watched"));
  await page.wait("!!document.querySelector('input[type=url]')");
  await page.eval("document.querySelector('input[type=url]').focus()");
  await page.type(`${origin()}${path}`);
}

export async function saveScout(page) {
  await page.eval(`${button("Save")}.click()`);
  await page.wait("!document.querySelector('form[aria-label=\"New Scout\"]')");
}

/** Settings ▸ What it talks to: a key typed into the one field that never shows it back. */
export async function storeKey(page, key) {
  await page.eval("location.hash='#/settings'");
  await page.wait("!!document.querySelector('input[aria-label=\"Key\"]')");
  await page.eval(
    "document.querySelector('input[aria-label=\"Key\"]').focus()"
  );
  await page.type(key);
  await page.eval(`${button("Store")}.click()`);
  await page.wait("document.body.innerText.includes('a key is stored')", 10000);
}
