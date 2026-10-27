// Shared by the drives (docs/agents/run.md). A drive takes its own pictures,
// dark then light, since the hidden snapshot is one per launch.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  button,
  openQueue,
  press,
  storeKey,
} from "../page-change-demo/helpers.mjs";
import { fillPageScout, saveScout } from "../watched-demo/helpers.mjs";
export { button, fillPageScout, openQueue, press, saveScout, storeKey };

export const NAME = "Anthropic alignment";
export const TRACING = "Tracing the thoughts of a large language model";
export const REWARD = "Natural Emergent Misalignment from Reward Hacking";

export const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

export async function shoot(page, name) {
  for (const theme of ["dark", "light"]) {
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: theme }],
    });
    await page.sleep(500);
    const { data } = await page.send("Page.captureScreenshot", {
      format: "png",
    });
    writeFileSync(
      join(process.env.DEMO_OUT, `${name}-${theme}.png`),
      Buffer.from(data, "base64")
    );
    console.log(`shot ${name}-${theme}`);
  }
}

/**
 * *Run now* in the Scout's header, reached by choosing it on the rail: the
 * rail only filters since #857, so scout-demo's rail-row button is gone.
 */
export async function runNow(page, name) {
  const entry = `[...document.querySelectorAll('ul[aria-label="Scouts"] li button')].find(b => b.innerText.includes(${JSON.stringify(name)}))`;
  await page.wait(`!!${entry}`, 20000);
  await page.eval(`${entry}.click()`);
  await page.wait(
    `[...document.querySelectorAll('h2')].some(h => h.textContent === ${JSON.stringify(name)})`
  );
  await page.eval(`${button("Run now")}.click()`);
}

const batchToggle = `[...document.querySelectorAll('button[aria-expanded]')].find(b => b.innerText.includes(${JSON.stringify(NAME)}) && b.innerText.includes('first look'))`;

/** The Scout's first-look batch, open, with one title chosen; its card's text. */
export async function chooseInBatch(page, title) {
  await page.wait(`!!${batchToggle}`, 30000);
  await page.eval(
    `${batchToggle}.getAttribute('aria-expanded') === 'true' || ${batchToggle}.click()`
  );
  const row = `document.querySelector('[aria-label=${JSON.stringify(`${NAME} first look`)}] button[aria-label=${JSON.stringify(title)}]')`;
  await page.wait(`!!${row}`, 10000);
  await page.eval(`${row}.click()`);
  return cardText(page, title);
}

export async function cardText(page, title) {
  const card = `document.querySelector('article[aria-label=${JSON.stringify(title)}]')`;
  await page.wait(`!!${card}`, 10000);
  // The card opens under its row, often below the fold: the picture is of it.
  await page.eval(`${card}.scrollIntoView({ block: 'center' })`);
  return page.eval(`${card}.innerText`);
}
