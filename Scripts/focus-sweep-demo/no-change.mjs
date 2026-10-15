// Step 2: the same vault, relaunched with nothing changed. Watches the footer
// for the whole settle window and throws on an Ingest line.
import {
  expect,
  footer,
  ingestLine,
  looseEnds,
} from "../linked-folder-demo/helpers.mjs";
export default async (page) => {
  let line = null;
  let foot = "";
  for (let i = 0; i < 30 && line === null; i++) {
    line = await ingestLine(page);
    foot = await footer(page);
    await page.sleep(100);
  }
  console.log(`FOOTER: ${foot}`);
  expect(line === null, "the footer has no Ingest line", foot);
  expect(
    !foot.includes("papers not arriving"),
    "the footer has no fault line",
    foot
  );
  const text = await looseEnds(page);
  expect(!text.includes("PDF missing"), "no Source says PDF missing", text);
  expect(
    text.includes("PDF · no Source") && text.includes("stray.pdf"),
    "Loose Ends holds only what the first launch left: the stray PDF",
    text
  );
};
