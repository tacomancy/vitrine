// Shared by the drives (docs/agents/run.md). The stand-in's origin arrives in
// the environment of the launching script.
import {
  button,
  openQueue,
  press,
  railText,
  runNow,
} from "../scout-demo/helpers.mjs";
import { fillPageScout, saveScout } from "../watched-demo/helpers.mjs";
export { button, fillPageScout, openQueue, press, railText, runNow, saveScout };

/**
 * Settings ▸ What it talks to, once its keychain probe has answered: a field
 * focused before that is rebuilt under the typing, and the key lands nowhere.
 */
export async function storeKey(page, key) {
  await page.eval("location.hash='#/settings'");
  await page.wait(
    "document.body.innerText.includes('Keychain checked')",
    15000
  );
  await page.eval(
    "document.querySelector('input[aria-label=\"Key\"]').focus()"
  );
  await page.type(key);
  await page.eval(`${button("Store")}.click()`);
  await page.wait("document.body.innerText.includes('a key is stored')", 10000);
}

export const NAME = "Sleep lab";
export const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

const byLabel = (label) =>
  `[...document.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)})`;
export const click = (page, label) => page.eval(`${byLabel(label)}.click()`);

/** A field set the way a person's typing sets it, for React to see. */
export const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

/** Scout Activity ▸ the Scout's row ▸ open the form: the one place a page is changed. */
export async function openFormFromActivity(page) {
  await page.eval("location.hash='#/scout-activity'");
  await page.wait(
    "!!document.querySelector('table[aria-label=\"Scouts\"]')",
    20000
  );
  await page.wait(`!!${byLabel(`${NAME}: edit`)}`, 20000);
  await click(page, `${NAME}: edit`);
  await page.wait(
    `!!document.querySelector('form[aria-label="Edit ${NAME}"]')`
  );
  await page.eval(`${button("open the form")}.click()`);
  await page.wait("!!document.querySelector('input[type=url]')", 10000);
}

export const newAddress = () => `${process.env.DEMO_ORIGIN}/new/`;
