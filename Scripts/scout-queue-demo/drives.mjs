// What a researcher does on the revamped Scout Queue, one function per launch
// of the closing run (#842), chosen by DEMO_STEP. Each throws when the page
// does not show what its step claims, so a green run is the evidence. A step
// takes its own pictures (the hidden snapshot is one per launch) into
// DEMO_OUT: dark, a narrow window, then light.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};
const body = (page) => page.eval("document.body.innerText");
const press = (page, label) =>
  page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!b) throw new Error('no button ' + ${JSON.stringify(label)});
    b.click();
  })()`);
const letter = (page, ch, modifiers = 0) =>
  page.key(modifiers ? ch.toUpperCase() : ch, {
    code: `Key${ch.toUpperCase()}`,
    vk: ch.toUpperCase().charCodeAt(0),
    modifiers,
    ...(modifiers ? {} : { text: ch }),
  });

const shoot = async (page, name) => {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    join(process.env.DEMO_OUT, `${name}.png`),
    Buffer.from(data, "base64")
  );
  console.log(`shot ${name}`);
};

/** The same page in a narrow window, then in the light theme, then put back. */
const shootThreeWays = async (page, name) => {
  await shoot(page, `${name}-dark`);
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 640,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.sleep(500);
  await shoot(page, `${name}-narrow`);
  await page.send("Emulation.clearDeviceMetricsOverride");
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await page.sleep(500);
  await shoot(page, `${name}-light`);
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await page.sleep(300);
};

/** The Queue, after the launch's two due Scouts have answered and the page has stopped changing. */
async function openQueue(page) {
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await page.eval("location.hash='#/scouts'");
  await page.wait("!!document.querySelector('#scout-tile-sleep')", 20000);
  for (let was = await body(page), i = 0; i < 12; i++) {
    await page.sleep(2500);
    const now = await body(page);
    if (now === was) return;
    was = now;
  }
  throw new Error("demo: the Queue never settled");
}

const tile = async (page, id) => {
  await page.eval(`document.querySelector('#scout-tile-${id}').click()`);
  await page.sleep(500);
};
const rows = (page, label) =>
  page.eval(
    `[...document.querySelectorAll('[aria-label=${JSON.stringify(label)}] li button')].map(b => b.getAttribute('aria-label'))`
  );
const selectedTitle = (page) =>
  page.eval(
    `document.querySelector('[aria-current="true"]')?.getAttribute('aria-label') ?? ''`
  );
/** *Reject this run* on the batch of the Scout named. */
const rejectRunOf = (page, scout) =>
  page.eval(`(() => {
    const head = [...document.querySelectorAll('button[aria-expanded]')].find(b => b.innerText.includes(${JSON.stringify(scout)})).parentElement;
    [...head.querySelectorAll('button')].find(b => b.textContent.trim() === 'Reject this run').click();
  })()`);
const footer = (page) =>
  page.eval(`document.querySelector('footer')?.innerText ?? ''`);

export const steps = {
  // Triage by keys: J/K move, A accepts, D defers, R rejects, each selecting
  // the next; the footer says the last act and offers its undo.
  async triage(page) {
    await openQueue(page);
    await tile(page, "sleep");
    const body0 = await body(page);
    expect(
      /only Sleep and consolidation/.test(body0),
      "the filter says it is on"
    );
    const first = await selectedTitle(page);
    console.log(`SELECTED: ${first}`);
    expect(first !== "", "a row is selected on arrival");
    await letter(page, "j");
    await page.sleep(300);
    const second = await selectedTitle(page);
    expect(second !== first, "J moves down the list");
    await letter(page, "k");
    await page.sleep(300);
    expect((await selectedTitle(page)) === first, "K moves back");
    await letter(page, "r");
    await page.wait("/Rejected “/.test(document.body.innerText)", 5000);
    expect(
      /undo · U/.test(await footer(page)),
      "the footer offers the reject's undo"
    );
    await letter(page, "u");
    await page.wait("!/Rejected “/.test(document.body.innerText)", 5000);
    await letter(page, "a");
    await page.wait("/Accepted into/.test(document.body.innerText)", 8000);
    expect(!/undo · U/.test(await footer(page)), "an accept offers no undo");
    await letter(page, "d");
    await page.wait("/Deferred/.test(document.body.innerText)", 5000);
    // Each pane scrolls on its own, so moving through the list keeps the
    // strip where it was (prototype 14).
    for (let i = 0; i < 6; i++) await letter(page, "j");
    await page.sleep(400);
    expect(
      (await page.eval(
        `document.querySelector('[aria-label="Scouts"]').getBoundingClientRect().top`
      )) >= 0,
      "the strip stays in view while J moves down the list"
    );
    await shootThreeWays(page, "1-triage");
  },

  // A filter opens the Scout's header; show all clears it.
  async filter(page) {
    await openQueue(page);
    await tile(page, "sleep");
    const body1 = await body(page);
    expect(/below your cap of 2/.test(body1), "the Scout header holds the Cap");
    expect(/Run now/.test(body1), "the Scout header holds Run now");
    await press(page, "show all");
    await page.sleep(400);
    expect(
      !/only Sleep and consolidation/.test(await body(page)),
      "show all clears"
    );
    await tile(page, "sleep");
    await tile(page, "sleep");
    expect(
      !/only Sleep and consolidation/.test(await body(page)),
      "a second click clears"
    );
    await tile(page, "sleep");
    await shootThreeWays(page, "2-filter");
  },

  // Retroactive batches apart from new finds: expand one, select a title,
  // reject the other as a run, read the footer, undo it.
  async batch(page) {
    await openQueue(page);
    const text = await body(page);
    expect(
      /RETROACTIVE|Retroactive/.test(text),
      "the batches have their own heading"
    );
    expect(
      /Lab publications page[\s\S]*6 left · first look at the page · \$0\.41/.test(
        text
      ),
      "a batch says its Scout, what is left, what it was and what it cost"
    );
    expect(
      !(await rows(page, "New finds")).some((t) =>
        /earlier paper/.test(t ?? "")
      ),
      "no Retroactive title is among the new finds"
    );
    await page.eval(
      `[...document.querySelectorAll('button[aria-expanded]')].find(b => b.innerText.includes('Lab publications page')).click()`
    );
    await page.sleep(400);
    const titles = await rows(page, "Lab publications page first look");
    expect(titles.length === 6, "expanding lists the batch's six titles");
    await page.eval(
      `document.querySelector('[aria-label="Lab publications page first look"] li:nth-child(2) button').click()`
    );
    await page.sleep(400);
    expect(
      (await selectedTitle(page)) === titles[1],
      "a click on a batch title selects it"
    );
    await shootThreeWays(page, "3-batch-expanded");
    // Reject the other run as a unit.
    await rejectRunOf(page, "Back catalogue");
    await page.wait(
      "/Rejected this run of Back catalogue \\(4\\) · not counted toward accept rate/.test(document.body.innerText)",
      5000
    );
    expect(
      !/Back catalogue/.test(
        await page.eval(
          `document.querySelector('[aria-labelledby="retroactive-heading"]').innerText`
        )
      ),
      "the rejected batch leaves the list"
    );
    await shoot(page, "3-batch-run-rejected");
    await letter(page, "u");
    await page.wait(
      "/Back catalogue/.test(document.querySelector('[aria-labelledby=\"retroactive-heading\"]')?.innerText ?? '')",
      5000
    );
    console.log("BATCH: rejected a run of four and undid it as a unit");
  },

  // Reject the whole batch and leave it rejected, so the queue can be read.
  async batchReject(page) {
    await openQueue(page);
    await rejectRunOf(page, "Back catalogue");
    await page.wait(
      "/not counted toward accept rate/.test(document.body.innerText)",
      5000
    );
  },

  // Skim: the same frame, no reject, defer or pass.
  async skim(page) {
    await openQueue(page);
    await page.eval(
      `[...document.querySelectorAll('[role="tab"]')].find(b => /^Skim/.test(b.textContent.trim())).click()`
    );
    await page.sleep(600);
    const text = await body(page);
    expect(/Send to Review/.test(text), "Skim offers Send to Review");
    expect(
      !/\bReject\b|\bDefer\b|\bPass\b/.test(
        await page.eval(`document.querySelector('article')?.innerText ?? ''`)
      ),
      "Skim keeps nothing to clear"
    );
    await page.key("ArrowDown", { code: "ArrowDown", vk: 40 });
    await shootThreeWays(page, "4-skim");
  },

  // Muted: the rules, what they hold, and the by-name search, from the header link.
  async muted(page) {
    await openQueue(page);
    await press(page, "Mute rules");
    await page.sleep(600);
    const text = await body(page);
    expect(/Mute by name/.test(text), "the Muted tab holds Mute by name");
    await shootThreeWays(page, "5-muted");
  },

  // Group by Question: the strip becomes Question tiles.
  async question(page) {
    await openQueue(page);
    await press(page, "group: scout");
    await page.wait(
      "document.querySelectorAll('[aria-label=\"Questions\"] button').length > 1",
      10000
    );
    expect(
      (await body(page)).includes("A paper can be in several groups"),
      "the page says a paper can be in several groups"
    );
    await shootThreeWays(page, "6-by-question");
    await press(page, "group: question");
  },

  // A Scout file that does not parse keeps its tile, and a rules file that
  // does not parse is said by name in the footer: neither looks like quiet.
  async broken(page) {
    await openQueue(page);
    const strip = await page.eval(
      `document.querySelector('[aria-label="Scouts"]').innerText`
    );
    expect(
      /broken\.yaml/.test(strip),
      "the broken Scout keeps a tile by file name"
    );
    // The strip is one row that scrolls sideways; bring the tile into the picture.
    await page.eval(
      `[...document.querySelectorAll('[aria-label="Scouts"] li')].find(li => li.innerText.includes('broken.yaml')).scrollIntoView({ inline: 'center' })`
    );
    expect(
      /mute rules not read/.test(await footer(page)),
      "the unreadable rules file is named in the footer"
    );
    expect(
      !/nothing is broken/i.test(await body(page)),
      "nothing claims the field is quiet"
    );
    await shootThreeWays(page, "7-broken");
  },
};

export default (page) => {
  const step = steps[process.env.DEMO_STEP];
  if (step === undefined)
    throw new Error(`no demo step ${process.env.DEMO_STEP}`);
  return step(page);
};
