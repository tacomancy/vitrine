// Shared by the drives: what a researcher does on the Scout Queue, as page
// scripts (docs/agents/run.md).
export const button = (label) =>
  `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='${label}')`;

export const press = (page, letter) =>
  page.key(letter, {
    code: `Key${letter.toUpperCase()}`,
    vk: letter.toUpperCase().charCodeAt(0),
    text: letter,
  });

export async function openQueue(page) {
  await page.eval("location.hash='#/scouts'");
  await page.wait("!!document.querySelector('[aria-label=\"Scout Queue\"]')");
}

export async function fillNewScout(page, { name, query, lane }) {
  await page.eval(`location.hash = "#/scout-management/new"`);
  await page.wait("!!document.querySelector('form[aria-label=\"New Scout\"]')");
  await page.type(name); // the form focuses Name on mount
  await page.eval("document.querySelector('textarea').focus()");
  await page.type(query);
  if (lane === "skim") {
    await page.eval(`(() => {
      const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='skim'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'skim');
      s.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
  }
}

/**
 * *Run now* in the Scout's header, reached by choosing it on the rail: the
 * rail only filters since #857, so a rail row has no button of its own.
 * Saving a Scout leaves its form, not for the Queue, so the Queue is opened
 * first.
 */
export async function runNow(page, name) {
  await openQueue(page);
  const entry = `[...document.querySelectorAll('ul[aria-label="Scouts"] li button')].find(b => b.innerText.includes(${JSON.stringify(name)}))`;
  await page.wait(`!!${entry}`, 20000);
  // Choosing a chosen entry clears the choice, so press it only if it is not.
  await page.eval(
    `${entry}.getAttribute('aria-pressed') === 'true' || ${entry}.click()`
  );
  await page.wait(
    `[...document.querySelectorAll('h2')].some(h => h.textContent === ${JSON.stringify(name)})`
  );
  await page.eval(`${button("Run now")}.click()`);
}

/**
 * The Scout's first-look batch, opened: a Retroactive run is a collapsed batch
 * on the Queue. Returns the selector of its list of rows.
 */
export async function openFirstLook(page, name, ms = 20000) {
  const toggle = `[...document.querySelectorAll('button[aria-expanded]')].find(b => b.innerText.includes(${JSON.stringify(name)}) && b.innerText.includes('first look'))`;
  await page.wait(`!!${toggle}`, ms);
  await page.eval(
    `${toggle}.getAttribute('aria-expanded') === 'true' || ${toggle}.click()`
  );
  return `[aria-label=${JSON.stringify(`${name} first look`)}]`;
}

/** Its first row chosen, so a card is drawn: only the chosen row has one. */
export async function chooseFirstLook(page, name, ms) {
  const list = await openFirstLook(page, name, ms);
  const row = `document.querySelector(${JSON.stringify(`${list} button`)})`;
  await page.wait(`!!${row}`, 10000);
  await page.eval(`${row}.click()`);
  await page.wait("!!document.querySelector('article[aria-label]')", 10000);
}

export const railText = (page) =>
  page.eval("document.querySelector('ul[aria-label=\"Scouts\"]').innerText");
