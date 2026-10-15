// Shared by the drives (docs/agents/run.md). The launching script puts the
// scratch vault and the PDF it copies in the environment.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const vault = () => process.env.DEMO_VAULT;
export const count = () => Number(process.env.DEMO_COUNT ?? 50);
export const name = (i) => `p${String(i).padStart(2, "0")}`;

/**
 * A PDF returned by a sync client or Preview: the fixture's bytes with a
 * different tail each, so no two files share a hash and every one is a change
 * of its own. A comment after `%%EOF` is ignored by a reader.
 */
export function deliver(path, source, tag) {
  copyFileSync(source, path);
  const bytes = readFileSync(path);
  writeFileSync(path, Buffer.concat([bytes, Buffer.from(`%${tag}\n`)]));
}

/** The footer's Ingest sentence, or null while there is none. */
export const footerLine = (page) =>
  page.eval(
    "[...document.querySelectorAll('footer')].map(f=>f.innerText).join(' ').match(/\\d+ new · \\d+ questions · \\d+ removed · \\d+ could not be re-matched/)?.[0] ?? null"
  );

/** Every distinct footer line seen while `during` runs, in order. */
export async function watchFooter(page, during) {
  const seen = [];
  let on = true;
  const poll = (async () => {
    while (on) {
      const line = await footerLine(page);
      if (line && seen.at(-1)?.line !== line) {
        seen.push({ line, at: Date.now() });
        console.log(`LINE at ${sinceLaunch()} ms: ${line}`);
      }
      await page.sleep(100);
    }
  })();
  try {
    await during();
  } finally {
    on = false;
    await poll;
  }
  return seen;
}

/** The previous launch's line has faded, so the next burst starts clean. */
export const waitForQuiet = (page) =>
  page.wait("!document.body.innerText.includes(' new · ')", 20000);

export const blocks = (note) =>
  (readFileSync(note, "utf8").match(/^- p\.\d+ · /gm) ?? []).length;

export { join };

/** Milliseconds since the launching script spawned this app, for tuning --after. */
export const sinceLaunch = () => Date.now() - Number(process.env.DEMO_T0);
