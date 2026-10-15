// Step 1: fifty PDFs written into the PDF folder five at a time, 1.5 s apart —
// longer than the 2 s settle window in all, so the watcher cuts the delivery
// into several Batches. One footer line with the whole count, and every
// Source's note holds its blocks.
import { join } from "node:path";
import {
  blocks,
  count,
  deliver,
  name,
  vault,
  waitForQuiet,
  watchFooter,
} from "./helpers.mjs";

export default async (page) => {
  await waitForQuiet(page);
  const source = process.env.DEMO_PDF;
  const started = Date.now();
  const seen = await watchFooter(page, async () => {
    for (let i = 1; i <= count(); i += 5) {
      for (let j = i; j < i + 5 && j <= count(); j++)
        deliver(join(vault(), `sources/pdf/${name(j)}.pdf`), source, name(j));
      await page.sleep(1500);
    }
    console.log(`DELIVERED in ${Date.now() - started} ms`);
    await page.wait("document.body.innerText.includes(' new · ')", 30000);
    await page.sleep(1000);
  });
  const each = blocks(join(vault(), `sources/${name(1)}.md`));
  for (let i = 1; i <= count(); i++) {
    const n = blocks(join(vault(), `sources/${name(i)}.md`));
    if (n !== each || n === 0)
      throw new Error(`${name(i)}: ${n} blocks, expected ${each}`);
  }
  console.log(
    `FOOTER LINES SEEN: ${JSON.stringify(seen.map((s) => `${s.line} (+${s.at - started} ms)`))}`
  );
  // The line counts what Ingest reports as new, which is not only the blocks;
  // what makes it the whole delivery is that it is one line, every PDF's share
  // alike.
  const landed = Number(seen[0]?.line.split(" ")[0]);
  if (seen.length !== 1 || landed === 0 || landed % count() !== 0)
    throw new Error(`expected one line holding all ${count()} PDFs`);
  console.log(`BLOCKS PER NOTE: ${each}; all ${count()} notes hold them`);
};
