// What the page must show on each launch of the Home demo (#737), chosen by
// DEMO_STEP. Each throws when Home does not show what its step claims, so a
// green run is the evidence. Every drive also logs each line of Home that
// carries a digit: the closing ticket's "page read for any number that does
// not lead somewhere" is that list, read.
import { BROKEN, RESURFACE_TITLES } from "./vault.mjs";

const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

const home = (page) =>
  page.eval(
    `document.querySelector('section[aria-labelledby="home-title"]')?.innerText ?? ''`
  );

async function settled(page) {
  await page.eval("location.hash='#/home'");
  await page.wait(
    `!!document.querySelector('section[aria-labelledby="home-title"]')`,
    20000
  );
  // Scouts due at launch answer a few seconds in, and Home re-queries as each does.
  for (let was = await home(page), i = 0; i < 12; i++) {
    await page.sleep(2500);
    const now = await home(page);
    if (now === was && i > 1) return now;
    was = now;
  }
  throw new Error("demo: Home never settled");
}

/** The absences Home must never have, whatever it is showing. */
async function never(page, text) {
  expect(
    !/nothing is (broken|wrong)/i.test(text),
    "Home never says nothing is broken"
  );
  expect(
    !/loose ends\s*[·(]?\s*\d/i.test(text),
    "no figure sits beside Loose Ends"
  );
  expect(
    (await page.eval(
      `document.querySelectorAll('section[aria-labelledby="home-title"] [role="alert"]').length`
    )) === 0,
    "no alert for a state"
  );
  const links = await page.eval(
    `[...document.querySelectorAll('nav[aria-label="Dashboards"] a')].map(a => a.textContent.trim())`
  );
  expect(
    JSON.stringify(links) ===
      JSON.stringify(["Loose Ends", "Question Map", "Scout Activity"]),
    "the dashboards foot is three bare links"
  );
  for (const line of text.split("\n").filter((l) => /\d/.test(l)))
    console.log(`NUMBER: ${line.trim()}`);
}

export const steps = {
  // Every Scout looking, nothing pending, nothing changed: a claim with its
  // Warrant in each place, and no interrupt.
  async quiet(page) {
    const text = await settled(page);
    console.log(`QUIET:\n${text}`);
    expect(/3 scouts watching/i.test(text), "the fleet is claimed as watching");
    expect(!/not working/.test(text), "no Scout is named as broken");
    expect(
      (await page.eval(
        `!!document.querySelector('[aria-label="Scouts that are not working"]')`
      )) === false,
      "no interrupt"
    );
    expect(
      /Review is empty/.test(text),
      "an empty Review is a claim with the fleet's Warrant"
    );
    expect(
      /Nothing has changed\./.test(text),
      "an empty window is a claim with its Warrant"
    );
    expect(/Skim is a feed with no depth/.test(text), "the Skim line");
    await never(page, text);
  },

  // A Scout failing, a Review with depth, a fortnight's changes by Tag, and
  // Questions come back from the notebook.
  async full(page) {
    const text = await settled(page);
    console.log(`FULL:\n${text}`);
    expect(
      /away since the/.test(text),
      "the dateline says when the last visit was"
    );
    expect(text.includes(`${BROKEN}`), "the broken Scout is named");
    const interrupt = await page.eval(
      `document.querySelector('[aria-label="Scouts that are not working"]')?.innerText ?? ''`
    );
    expect(interrupt.includes(BROKEN), "the interrupt names it");
    expect(
      /run now/.test(interrupt) && /pause/.test(interrupt),
      "the interrupt offers run now and pause"
    );
    expect(
      !/watching/.test(text.split("\n")[2] ?? ""),
      "the claim is withheld while a Scout is broken"
    );
    expect(/12 in Review/.test(text), "Review has depth");
    expect(
      /median/.test(text) && /oldest/.test(text),
      "median and oldest are facts beside it"
    );
    expect(/2 deferred/.test(text), "deferred is beside the headline");
    expect(/Skim is a feed with no depth/.test(text), "the Skim line");
    const topics = await page.eval(
      `[...document.querySelectorAll('#home-changed-title ~ div h3')].map(h => h.textContent.trim())`
    );
    console.log(`TOPICS: ${topics.join(" | ")}`);
    expect(
      JSON.stringify(topics) ===
        JSON.stringify(["memory/consolidation", "memory/encoding", "untagged"]),
      "groups are Tags as written, then untagged last"
    );
    expect(topics.includes("untagged"), "an untagged item has its own group");
    expect(
      /Working answer revised/.test(text),
      "a Revision is named by its field"
    );
    expect(/Question captured/.test(text), "a Question captured is an item");
    expect(/Note edited/.test(text), "a Note edited from its mtime is an item");
    const picked = await page.eval(
      `[...document.querySelectorAll('#notebook-title ~ ul li')].length || document.querySelectorAll('section[aria-labelledby="notebook-title"] li').length`
    );
    expect(picked === 3, "three Questions come back from the notebook");
    expect(/↻ others/.test(text), "the rotation can be turned");
    expect(
      RESURFACE_TITLES.some((t) => text.includes(t)) ||
        /slow-wave density predict recall gain/.test(text),
      "an old Question is among them"
    );
    await never(page, text);
  },
};

export default async (page) => steps[process.env.DEMO_STEP](page);
