// Shared by the drives: what a researcher does on the Attention panel, as
// page scripts (docs/agents/run.md).
export {
  applyTheme,
  expect,
  openMap,
} from "../question-map-demo/helpers.mjs";

const attention =
  "document.querySelector('section[aria-labelledby=attention-title]')";

/** The panel's read finished: its *as of* line is there. */
export async function openPanel(page) {
  await page.wait(`!!${attention}?.querySelector('button')`, 30000);
}

export const panelText = (page) => page.eval(`${attention}.innerText`);

export const chooseTag = async (page, display) => {
  await page.eval(
    `[...${attention}.querySelectorAll('button[aria-pressed]')].find(b=>b.querySelector('span')?.textContent===${JSON.stringify(display)}).click()`
  );
  await page.wait(
    `!!${attention}.querySelector('section[aria-label="Lexicon: ${display}"]')`
  );
};

export const editorText = (page, display) =>
  page.eval(
    `${attention}.querySelector('section[aria-label="Lexicon: ${display}"]').innerText`
  );

export const clickButton = (page, label) =>
  page.eval(
    `[...${attention}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`
  );

/** An input set the way a person's typing sets it, for React to see. */
export const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

export const points = (page) =>
  page.eval(
    `[...${attention}.querySelectorAll('[role=option]')].map(o=>o.getAttribute('aria-label'))`
  );

/** The capture is the window, and the panel sits below the matrix and the review: bring it to the top. */
export const bring = (page) =>
  page.eval(`${attention}.scrollIntoView({ block: "start" })`);

/** What the two pages say, to be compared with the same pages once the scatter has pending and failed Tags (4). */
export const quiet = async (page) => {
  const seen = {};
  for (const hash of ["#/loose-ends", "#/"]) {
    await page.eval(`location.hash=${JSON.stringify(hash)}`);
    await page.sleep(2500);
    seen[hash] = await page.eval("document.body.innerText");
  }
  return seen;
};
