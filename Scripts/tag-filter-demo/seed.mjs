// 2. A Seed in the Tag's Lexicon editor. It runs nothing: the next run is
// the one that asks for it.
import {
  chooseTag,
  editorText,
  expect,
  openMap,
  openPanel,
  setValue,
} from "./helpers.mjs";
export default async (page) => {
  await openMap(page);
  await openPanel(page);
  await chooseTag(page, "probing");
  await page.eval(
    setValue('input[aria-label="Seed a term"]', "activation steering")
  );
  await page.eval(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Seed').click()`
  );
  await page.wait(
    `document.querySelector('section[aria-label="Lexicon: probing"]')?.innerText.includes('activation steering')`,
    10000
  );
  const editor = await editorText(page, "probing");
  expect(editor.includes("activation steering"), "the Seed is in the Lexicon");
  console.log(`EDITOR: ${editor.replace(/\n+/g, " | ")}`);
};
