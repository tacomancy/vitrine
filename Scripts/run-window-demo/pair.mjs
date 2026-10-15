// Step 3: two PDFs attached back to back from Loose Ends. Each attach reads
// at once, so two runs land seconds apart: one footer line, both counts.
import { join } from "node:path";
import {
  blocks,
  footerLine,
  vault,
  waitForQuiet,
  watchFooter,
} from "./helpers.mjs";

const button = (label) =>
  `[...document.querySelectorAll('button')].find(b=>b.textContent==='${label}')`;

export default async (page) => {
  await waitForQuiet(page);
  await page.eval("location.hash='#/loose-ends'");
  await page.wait(`!!${button("attach to a stub")}`);
  const seen = await watchFooter(page, async () => {
    for (const stub of ["Stub 1", "Stub 2"]) {
      // A picker opened before the Source list has refreshed still offers the
      // stub the last attach took; close it and open it again.
      for (let tries = 0; ; tries++) {
        await page.eval(`${button("attach to a stub")}.click()`);
        await page.wait("!!document.querySelector('#picker-candidate-0')");
        const offered = await page.eval(
          "document.querySelector('#picker-candidate-0').innerText"
        );
        if (offered.includes(stub)) break;
        if (tries === 5) throw new Error(`the picker never offered ${stub}`);
        await page.key("Escape", { vk: 27 });
        await page.sleep(500);
      }
      await page.key("Enter", { vk: 13, text: "\r" });
      await page.wait("!document.querySelector('#picker-candidate-0')");
    }
    await page.sleep(500);
  });
  console.log(`FOOTER LINES SEEN: ${JSON.stringify(seen.map((s) => s.line))}`);
  console.log(`FINAL: ${await footerLine(page)}`);
  const held = ["lehmann2020", "okafor2021"].map((k) =>
    blocks(join(vault(), `sources/${k}.md`))
  );
  console.log(`BLOCKS IN THE TWO STUBS: ${held}`);
  if (
    held.filter((n) => n > 0).length !== 2 ||
    seen.length < 1 ||
    // A burst adds the second landing to the first: the count only grows.
    seen.some(
      (x, i) =>
        i > 0 &&
        Number(x.line.split(" ")[0]) <= Number(seen[i - 1].line.split(" ")[0])
    )
  )
    throw new Error("expected both stubs to hold blocks and a footer line");
};
