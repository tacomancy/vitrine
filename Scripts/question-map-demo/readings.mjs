// 2. Each reading opened to its full list.
import { expect, openMapRead, readingButtons } from "./helpers.mjs";
export default async (page) => {
  await openMapRead(page);
  const labels = await readingButtons(page);
  console.log("READINGS:", JSON.stringify(labels));
  expect(labels.length >= 2, "the readings that have members are drawn");
  for (let i = 0; i < labels.length; i++) {
    await page.eval(
      `document.querySelectorAll('[data-slot=readings] section > button')[${i}].click()`
    );
  }
  await page.wait(
    "document.querySelectorAll('[data-slot=readings] li').length > 0"
  );
  const open = await page.eval(
    "[...document.querySelectorAll('[data-slot=readings] section > button')].every(b=>b.getAttribute('aria-expanded')==='true')"
  );
  expect(open, "every reading opened to its list");
  console.log(
    "LISTS:",
    await page.eval(
      "document.querySelector('[data-slot=readings]').innerText.slice(0, 900)"
    )
  );
};
