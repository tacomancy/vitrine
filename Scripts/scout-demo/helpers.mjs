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
  await page.eval(`${button("+ New Scout")}.click()`);
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

/** Run now on the rail row naming the Scout; waits for the rail to have read it. */
export async function runNow(page, name) {
  const row = `[...document.querySelectorAll('ul[aria-label="Scouts"] li')].find(l=>l.innerText.includes(${JSON.stringify(name)}))`;
  await page.wait(`!!${row}`);
  await page.eval(
    `[...${row}.querySelectorAll('button')].find(b=>b.textContent==='Run now').click()`
  );
}

export const railText = (page) =>
  page.eval("document.querySelector('ul[aria-label=\"Scouts\"]').innerText");
