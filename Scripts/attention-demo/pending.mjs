// 3. A Seed changes what a Tag is measured as; its old point stays, marked.
import {
  bring,
  chooseTag,
  expect,
  openMap,
  openPanel,
  panelText,
  setValue,
} from "./helpers.mjs";
export default async (page) => {
  await openMap(page);
  await openPanel(page);
  await page.wait(
    `document.querySelectorAll('[role=option][aria-label*="growth"]').length>=5`
  );
  expect(
    !(await panelText(page)).includes("re-measure pending"),
    "nothing is pending before the Seed"
  );
  await chooseTag(page, "engrams");
  await page.eval(setValue('input[aria-label="Seed a term"]', "memory trace"));
  await page.eval(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Seed').click()`
  );
  await page.wait(
    `!!document.querySelector('[role=option][aria-label*="re-measure pending"]')`
  );
  const panel = await panelText(page);
  console.log("PANEL:", panel.replace(/\n+/g, " | "));
  expect(
    panel.includes("re-measure pending"),
    "the Tag is marked re-measure pending"
  );
  // The other edit: Exclude a derived Term, which is then listed to restore.
  await page.eval(
    `[...document.querySelectorAll('button[aria-label^="Exclude "]')][0].click()`
  );
  await page.wait(`!!document.querySelector('ul[aria-label=Excluded]')`);
  await bring(page);
};
