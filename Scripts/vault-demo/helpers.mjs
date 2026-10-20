// Shared by the drives (docs/agents/run.md).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const vaultPath = (rel) => join(process.env.VAULT_DEMO_VAULT, rel);
export const read = (rel) => readFileSync(vaultPath(rel), "utf8");
export const write = (rel, text) => writeFileSync(vaultPath(rel), text);
export const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

const EDITOR = "document.querySelector('.cm-content[aria-label=\"Editor\"]')";

/** The Address a person would paste; the router is the only reader of it. */
export async function openFile(page, rel) {
  await page.eval(
    `location.hash='#/vault/${rel.split("/").map(encodeURIComponent).join("/")}'`
  );
  await page.wait(`!!${EDITOR}`, 15000);
  await page.wait(
    `document.querySelector('[aria-label="Files"] [aria-current="page"]')?.textContent.includes(${JSON.stringify(rel.split("/").at(-1).replace(/\.md$/, ""))})`,
    15000
  );
}

/** A real click at the left of the element `js` evaluates to. */
export async function clickAt(page, js) {
  const { x, y } = await page.eval(
    `(() => { const r = (${js}).getBoundingClientRect(); return { x: r.left + 24, y: r.top + r.height / 2 }; })()`
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await page.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
    });
}

/** The cursor to the end of the last line (a click right of it), then `text`. */
export async function typeAtEnd(page, text) {
  await page.eval(`${EDITOR}.focus()`);
  // CM draws only the lines near the viewport, so the last line of a long
  // file is not in the DOM until the scroller is at the bottom.
  await page.eval(
    `(() => { const s = document.querySelector('.cm-scroller'); s.scrollTop = s.scrollHeight; })()`
  );
  await page.sleep(500);
  const { x, y } = await page.eval(
    `(() => { const r = ${EDITOR}.lastElementChild.getBoundingClientRect(); return { x: r.right - 4, y: r.top + r.height / 2 }; })()`
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await page.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  await page.type(text);
}

export const line = (text) =>
  `[...document.querySelectorAll('.cm-line')].find(l=>l.textContent.includes(${JSON.stringify(text)}))`;

export const button = (label) =>
  `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;

/** Autosave is a 2 s idle (IDLE_MS); this outwaits it. */
export const settle = (page) => page.sleep(3500);
