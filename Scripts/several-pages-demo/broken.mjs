// 5. The papers page breaks (the site answers 503) and *Run now* finds it:
//    the Scouts screen names the page under the Scout (5a), Loose Ends has a
//    row for the page (5b), and Home's interrupt a line for it (5c), while
//    the blog finds its new post and the talks page stays quiet.
// 6. The site mended, *run now* on Home's line reads that page alone, and
//    every surface has let it go (6a Home, 6b the Scouts screen).
import {
  KEY,
  NAME,
  expect,
  openQueue,
  openScouts,
  page,
  runAndWait,
  scoutHeader,
  shoot,
  storeKey,
  waitForLines,
} from "./helpers.mjs";

const body = (cdp) => cdp.eval("document.body.innerText");
const broken = `[aria-label="Scouts that are not working"]`;

export default async (cdp) => {
  await storeKey(cdp, KEY);
  await openQueue(cdp);
  await runAndWait(cdp, 3);
  const lines = await openScouts(cdp).then(() =>
    waitForLines(
      cdp,
      (l) =>
        l.length === 3 &&
        l[0].trim() === page("feed") &&
        /503/.test(l[1]) &&
        /parsed cleanly/.test(l[2]),
      "the papers page alone reads as broken"
    )
  );
  console.log(`PAGES: ${JSON.stringify(lines)}`);
  const header = await scoutHeader(cdp);
  console.log(`HEADER: ${header}`);
  expect(
    header.includes(`${page("papers")}:`),
    "the Scout's Voice names the broken page"
  );
  await shoot(cdp, "5a-broken-scouts-screen");

  await cdp.eval("location.hash='#/loose-ends'");
  await cdp.wait(
    `document.body.innerText.includes(${JSON.stringify(page("papers"))})`,
    15000
  );
  await cdp.sleep(1000);
  const loose = await body(cdp);
  console.log(`LOOSE ENDS: ${loose.slice(0, 900)}`);
  expect(
    loose.split(page("papers")).length === 2 &&
      !loose.includes(page("talks")) &&
      !loose.includes(page("feed")),
    "Loose Ends has one row for the broken page and none for its siblings"
  );
  await shoot(cdp, "5b-broken-loose-ends");

  await cdp.eval("location.hash='#/home'");
  await cdp.wait(`!!document.querySelector(${JSON.stringify(broken)})`, 15000);
  await cdp.sleep(1000);
  const home = await cdp.eval(
    `document.querySelector(${JSON.stringify(broken)}).innerText`
  );
  console.log(`HOME: ${home}`);
  expect(
    home.includes(page("papers")) && !home.includes(page("talks")),
    "Home's interrupt draws a line for the broken page"
  );
  await shoot(cdp, "5c-broken-home");

  // The lab's site comes back, with the paper it put up while it was down.
  await fetch(`${process.env.DEMO_ORIGIN}/__mend`);
  const runNow = `[aria-label=${JSON.stringify(`${NAME}, ${page("papers")}: run now`)}]`;
  await runAndWait(cdp, 1, () =>
    cdp.eval(`document.querySelector(${JSON.stringify(runNow)}).click()`)
  );
  // Positive as well as negative: an unmounted Home has no block either.
  await cdp.wait(
    `!document.querySelector(${JSON.stringify(broken)}) && document.body.innerText.includes('scout watching')`,
    15000
  );
  await cdp.sleep(1000);
  await shoot(cdp, "6a-mended-home");

  const after = await openScouts(cdp).then(() =>
    waitForLines(
      cdp,
      (l) => l.length === 3 && l[1].trim() === page("papers"),
      "the mended page reads as well"
    )
  );
  console.log(`PAGES AFTER: ${JSON.stringify(after)}`);
  await shoot(cdp, "6b-mended-scouts-screen");
};
