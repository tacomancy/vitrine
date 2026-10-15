// Shared by the drives (docs/agents/run.md). Each one reads the page's text,
// not its pixels, and throws when the page does not show what the step claims.

import { readFileSync } from "node:fs";

export const looseEnds = async (page) => {
  await page.eval("location.hash='#/loose-ends'");
  await page.wait("document.body.innerText.includes('Loose Ends')", 10000);
  await page.sleep(1500);
  return page.eval("document.body.innerText");
};

export const footer = (page) =>
  page.eval(
    "[...document.querySelectorAll('footer')].map(f=>f.innerText).join(' | ')"
  );

export function expect(ok, what, text) {
  console.log(`${ok ? "OK  " : "FAIL"} ${what}`);
  if (!ok) {
    console.log(text);
    throw new Error(`expected: ${what}`);
  }
}

/** Blocks the Source's note holds: the PDF's annotations once it has been read. */
export const blocks = () =>
  (readFileSync(process.env.DEMO_NOTE, "utf8").match(/^- p\.\d+ · /gm) ?? [])
    .length;

/** The Ingest summary sentence in the footer, or null while there is none. */
export const ingestLine = (page) =>
  page.eval(
    "[...document.querySelectorAll('footer')].map(f=>f.innerText).join(' ').match(/\\d+ new · \\d+ questions · \\d+ removed · \\d+ could not be re-matched/)?.[0] ?? null"
  );
