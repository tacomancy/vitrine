// Shared by the drives (docs/agents/run.md). A drive takes its own pictures,
// dark then light, since the hidden snapshot is one per launch.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  button,
  openQueue,
  press,
  runNow,
  storeKey,
} from "../page-change-demo/helpers.mjs";
import { fillPageScout, saveScout } from "../watched-demo/helpers.mjs";
import { openFirstLook } from "../scout-demo/helpers.mjs";
export { button, fillPageScout, openQueue, press, runNow, saveScout, storeKey };

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

/** The Scout's first-look batch, open, with one title chosen; its card's text. */
export async function chooseInBatch(page, title) {
  const list = await openFirstLook(page, NAME, 30000);
  const row = `document.querySelector(${JSON.stringify(`${list} button[aria-label=${JSON.stringify(title)}]`)})`;
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
