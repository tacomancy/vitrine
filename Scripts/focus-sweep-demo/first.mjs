// Step 1: the baseline. The PDF in the linked folder is read at open, so the
// next launch has nothing left to find.
import { blocks, expect } from "../linked-folder-demo/helpers.mjs";
export default async (page) => {
  for (let i = 0; i < 40 && blocks() === 0; i++) await page.sleep(100);
  expect(blocks() > 0, "the PDF's annotations are in the Source's note");
};
