// Step 2: the link is followed.
import { blocks, expect, ingestLine, looseEnds } from "./helpers.mjs";
export default async (page) => {
  // The open's read can land before the window is listening, so the line is
  // reported when it is seen and the note is what proves the read.
  let line = null;
  for (let i = 0; i < 20 && line === null; i++) {
    line = await ingestLine(page);
    if (line === null) await page.sleep(100);
  }
  console.log(
    `LINE: ${line ?? "not seen (landed before the window listened)"}`
  );
  const text = await looseEnds(page);
  expect(blocks() > 0, "the PDF's annotations are in the Source's note");
  expect(!text.includes("PDF missing"), "no Source says PDF missing", text);
  expect(
    text.includes("PDF · no Source") && text.includes("stray.pdf"),
    "the stray PDF is a no Source row",
    text
  );
};
