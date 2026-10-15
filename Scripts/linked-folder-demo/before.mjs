// Step 1, on a build of the commit before #572: the link is not followed.
import { blocks, expect, ingestLine, looseEnds } from "./helpers.mjs";
export default async (page) => {
  await page.sleep(3000);
  const text = await looseEnds(page);
  expect(
    text.includes("PDF missing"),
    "a Source whose PDF is there says PDF missing",
    text
  );
  expect(blocks() === 0, "the PDF present at launch is not read");
  expect((await ingestLine(page)) === null, "no Ingest line");
};
