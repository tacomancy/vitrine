// 1. A Lexicon derived and read, before anything is sent anywhere.
import { writeFileSync } from "node:fs";
import {
  bring,
  chooseTag,
  quiet,
  editorText,
  expect,
  openMap,
  openPanel,
  panelText,
} from "./helpers.mjs";
export default async (page) => {
  writeFileSync(process.env.AD_BASELINE, JSON.stringify(await quiet(page)));
  await openMap(page);
  await openPanel(page);
  const panel = await panelText(page);
  console.log("PANEL:", panel.replace(/\n+/g, " | "));
  expect(panel.includes("nothing synced"), "an unsynced vault says so");
  await chooseTag(page, "replay");
  const editor = await editorText(page, "replay");
  console.log("EDITOR:", editor.replace(/\n+/g, " | "));
  expect(editor.includes("hippocampal replay"), "the derived Term is shown");
  expect(
    /title_and_abstract\.search:\(/.test(editor),
    "the compiled OpenAlex query is shown verbatim"
  );
  await bring(page);
};
