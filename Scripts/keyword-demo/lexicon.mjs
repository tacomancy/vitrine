// One look at the Lexicon editor for the Tag `probing`, after the Ingest on
// open has landed: the Terms it shows, and where each came from. What it must
// and must not hold comes from KD_PRESENT and KD_ABSENT (comma lists).
import {
  bring,
  chooseTag,
  editorText,
  expect,
  openMap,
  openPanel,
} from "../attention-demo/helpers.mjs";

const list = (v) => (v ?? "").split(",").filter(Boolean);

export default async (page) => {
  await openMap(page);
  await openPanel(page);
  await chooseTag(page, "probing");
  const present = list(process.env.KD_PRESENT);
  const absent = list(process.env.KD_ABSENT);
  // The Ingest on open lands a moment after the page paints, and the open
  // editor refetches when it does (#683): wait for it, never reload.
  if (present.length)
    await page.wait(
      `(document.querySelector('section[aria-label="Lexicon: probing"]')?.innerText ?? "").includes(${JSON.stringify(present[0])})`,
      30000
    );
  else await page.sleep(6000);
  const editor = await editorText(page, "probing");
  console.log("EDITOR:", editor.replace(/\n+/g, " | "));
  for (const term of present) {
    expect(editor.includes(term), `the editor shows "${term}"`);
    expect(
      /author keyword/.test(editor),
      "a printed keyword is labelled author keyword"
    );
  }
  for (const term of absent)
    expect(!editor.includes(term), `the editor no longer shows "${term}"`);
  await bring(page);
};
