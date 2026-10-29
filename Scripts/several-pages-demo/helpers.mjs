// Shared by the drives (docs/agents/run.md). The stand-in's origin and the
// scratch vault arrive in the environment of the launching script; a drive
// takes its own pictures, since the hidden snapshot is one per launch.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  button,
  openQueue,
  press,
  runNow,
  storeKey,
} from "../page-change-demo/helpers.mjs";
import { PAGES } from "./standin.mjs";
export { button, openQueue, press, storeKey };

export const NAME = "Sleep lab";
export const KEY = "sk-demo-good";
export const page = (which) => `${process.env.DEMO_ORIGIN}${PAGES[which]}`;

export const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

export async function shoot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    join(process.env.DEMO_OUT, `${name}.png`),
    Buffer.from(data, "base64")
  );
  console.log(`shot ${name}`);
}

const finished = () => {
  const db = new DatabaseSync(
    join(process.env.DEMO_VAULT, ".vitrine/queue.sqlite"),
    { readOnly: true }
  );
  try {
    const { done, going } = db
      .prepare(
        "SELECT COUNT(finished) AS done, COUNT(*) - COUNT(finished) AS going FROM scout_runs"
      )
      .get();
    return going === 0 ? done : -1;
  } catch {
    // The app may hold the file mid-write; the next poll reads it.
    return -1;
  } finally {
    db.close();
  }
};

/**
 * *Run now*, then wait for the check to write its rows: the page says a run
 * is over only once it has re-read, so the queue is the clock. `rows` is how
 * many pages the check reads.
 */
export async function runAndWait(cdp, rows, run = () => runNow(cdp, NAME)) {
  const before = finished();
  expect(before >= 0, "no run is going before *run now*");
  await run();
  for (let i = 0; i < 120; i++) {
    const done = finished();
    // Exactly: one more would be a run the click did not start, and the
    // pictures would be of a check nobody asked for.
    if (done >= before + rows) {
      expect(done === before + rows, `the check wrote ${rows} runs, no more`);
      return;
    }
    await cdp.sleep(500);
  }
  throw new Error(`demo: the check never wrote its ${rows} runs`);
}

const PAGES_LIST = `ul[aria-label="${NAME}: pages"]`;
const pageLines = (cdp) =>
  cdp.eval(
    `[...document.querySelectorAll(${JSON.stringify(`${PAGES_LIST} > li`)})].map(li => li.innerText)`
  );

/** The Scout's header cell: its name, its Voice and its buttons. */
export const scoutHeader = (cdp) =>
  cdp.eval(
    `document.querySelector('table[aria-label="Scouts"] th[scope=row]').innerText`
  );

/** The Scouts screen with the Scout's row drawn, and its pages' lines as text, in file order. */
export async function openScouts(cdp) {
  await cdp.eval("location.hash='#/scout-management'");
  await cdp.wait(
    `!!document.querySelector(${JSON.stringify(PAGES_LIST)})`,
    20000
  );
  await cdp.sleep(1000);
  return pageLines(cdp);
}
/** Wait until `test` holds of the Scouts screen's page lines; they are re-read as runs land. */
export async function waitForLines(cdp, test, what, ms = 20000) {
  for (let t = 0; t < ms; t += 500) {
    const lines = await pageLines(cdp);
    if (test(lines)) return lines;
    await cdp.sleep(500);
  }
  throw new Error(`demo: ${what}, got ${JSON.stringify(await pageLines(cdp))}`);
}
