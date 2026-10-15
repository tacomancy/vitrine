// Shared by the drives: what a researcher does on Scout Activity, as page
// scripts (docs/agents/run.md).
export const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

export async function openActivity(page, rows = 12) {
  await page.eval("location.hash='#/scout-activity'");
  await page.wait(
    "!!document.querySelector('table[aria-label=\"Scouts\"]')",
    20000
  );
  // A launch runs every due Scout, and a row's health changes as each answers.
  await page.wait(
    `document.querySelectorAll('table[aria-label="Scouts"] tbody th').length >= ${rows}`,
    20000
  );
  // Quiet means the table said the same thing twice, a few seconds apart.
  const table = () =>
    page.eval(
      "document.querySelector('table[aria-label=\"Scouts\"]').innerText"
    );
  for (let was = await table(), i = 0; i < 12; i++) {
    await page.sleep(3000);
    const now = await table();
    if (now === was) return;
    was = now;
  }
  throw new Error("demo: the table never settled");
}

export const names = (page) =>
  page.eval(
    "[...document.querySelectorAll('table[aria-label=\"Scouts\"] tbody th')].map(th=>th.innerText.split('\\n')[0].trim())"
  );

export const byLabel = (label) =>
  `[...document.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)})`;

export const click = (page, label) => page.eval(`${byLabel(label)}.click()`);

export const present = (page, label) => page.eval(`!!${byLabel(label)}`);

/** A textarea or input set the way a person's typing sets it, for React to see. */
export const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

/** The row's own cells, without the detail rows it may have opened beneath it. */
export const rowText = (page, name) =>
  page.eval(
    `[...document.querySelectorAll('table[aria-label="Scouts"] tbody tr')].find(r=>r.querySelector('th')?.innerText.startsWith(${JSON.stringify(name)})).innerText`
  );
