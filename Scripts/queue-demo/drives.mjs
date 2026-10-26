// What a researcher does on the Scout Queue, one function per launch of the
// beat 6b demo (#650), chosen by DEMO_STEP. Each throws when the page does
// not show what its step claims, so a green run is the evidence.
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
const SHIFT = 8;
const META = 4;

/** The Queue, after the launch's two due Scouts have answered and the page has stopped changing. */
async function openQueue(page) {
  await page.eval("location.hash='#/scouts'");
  await page.wait("!!document.querySelector('#scout-rail-sleep')", 20000);
  // Two Scouts run at launch, three seconds apart at the earliest, and the
  // strip changes as each answers: quiet is the page saying the same twice.
  for (let was = await body(page), i = 0; i < 12; i++) {
    await page.sleep(2500);
    const now = await body(page);
    if (now === was) return;
    was = now;
  }
  throw new Error("demo: the Queue never settled");
}

/** A tile filters to its Scout; a second click on it would clear the filter. */
const tile = async (page, id) => {
  await page.eval(`document.querySelector('#scout-rail-${id}').click()`);
  await page.sleep(500);
};

const tab = async (page, name) => {
  await page.eval(
    `[...document.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim().startsWith(${JSON.stringify(name)})).click()`
  );
  await page.sleep(600);
};

/** The list's rows in order, each its title and the line saying why it sits there. */
const rows = (page) =>
  page.eval(
    `[...document.querySelectorAll('[aria-label="New finds"] li button')].map(b => b.innerText.replace(/\\s+/g, ' ').trim())`
  );
const selectedTitle = (page) =>
  page.eval(
    `document.querySelector('[aria-label="New finds"] [aria-current="true"]')?.getAttribute('aria-label') ?? ''`
  );
const detail = (page) =>
  page.eval(`document.querySelector('article')?.innerText ?? ''`);

export const steps = {
  // Rank puts the paper by an author the vault has accepted from first and
  // says why; the counterweight slot's paper is second and says what it is.
  async rank(page) {
    await openQueue(page);
    await tile(page, "sleep");
    expect(
      (await body(page)).includes("sort: rank"),
      "Rank is the default sort"
    );
    expect(
      (await selectedTitle(page)) ===
        "Spindle-locked replay predicts overnight gain",
      "the arrival by Jan Born is first, and selected"
    );
    expect(
      /by Jan Born, whose work you have accepted/.test(await detail(page)),
      "the card names the signal that raised it"
    );
    const ranked = await rows(page);
    console.log(`RANK: ${ranked.slice(0, 3).join(" | ")}`);
    expect(
      ranked[1]?.startsWith("Cortical spindles across species"),
      "the corroborated paper is second"
    );
    expect(
      ranked[1]?.includes("outside the usual"),
      "the slot says what it is"
    );
    expect(
      ranked.filter((t) => t.includes("outside the usual")).length === 1,
      "one slot, not several"
    );
    // Newest is one click away and carries no slot.
    await press(page, "sort: rank");
    await page.wait("/sort: newest/.test(document.body.innerText)", 5000);
    await page.sleep(500);
    const newest = await rows(page);
    console.log(`NEWEST: ${newest.slice(0, 4).join(" | ")}`);
    expect(
      !newest.some((t) => t.includes("outside the usual")),
      "Newest carries no slot"
    );
    expect(newest.length === ranked.length, "the same cards, reordered");
    await press(page, "sort: newest");
    await page.sleep(500);
  },

  // The two past-window papers sit behind one line, still counted.
  async digest(page) {
    await openQueue(page);
    await tile(page, "sleep");
    const text = await body(page);
    expect(
      /2 older than the window/.test(text),
      "the digest line counts the two aged papers"
    );
    expect(
      !text.includes("An older sleep paper (1)"),
      "aged papers are not in the list"
    );
    await press(page, "2 older than the window");
    await page.sleep(400);
    const open = await page.eval(
      `document.querySelector('[aria-label="Older than the window"]')?.innerText ?? ''`
    );
    expect(
      open.includes("An older sleep paper (1)") &&
        open.includes("An older sleep paper (2)"),
      "the digest opens to both"
    );
  },

  // The Cap kept two of four, said so, and gave the rest back on a click.
  async cap(page) {
    await openQueue(page);
    await tile(page, "sleep");
    expect(
      /2 below your cap of 2/.test(await body(page)),
      "the Cap says what it cut"
    );
    const before = (await rows(page)).length;
    await press(page, "Show them");
    await page.wait("!/below your cap/.test(document.body.innerText)", 5000);
    await page.sleep(500);
    const shown = await rows(page);
    console.log(`CAP: ${before} rows -> ${shown.length} rows`);
    expect(shown.length === before + 2, "the two come back into the list");
    const all = shown.join("|");
    expect(
      all.includes("Slow-wave amplitude and word-pair recall") &&
        all.includes("Napping and the fate of weak memories"),
      "the two capped papers are in the list"
    );
  },

  // A keyword rule: its reach before it is saved, then the Muted tab.
  async mute(page) {
    await openQueue(page);
    await tile(page, "sleep");
    await letter(page, "m");
    await page.wait(
      "!!document.querySelector('input[aria-label=\"Keyword\"]')"
    );
    await page.eval(
      `document.querySelector('input[aria-label="Keyword"]').focus()`
    );
    await page.type("listicle");
    await page.sleep(300);
    await press(page, "Mute keyword");
    await page.wait(
      "/Saving it would mute/.test(document.body.innerText)",
      5000
    );
    const reach = await body(page);
    expect(
      /Saving it would mute 3 pending items\./.test(reach),
      "the reach is said before the rule is saved"
    );
    await press(page, "Save rule");
    // The tab's count is the muted view's own read, so 3 is the rule's catch.
    await page.wait(
      "[...document.querySelectorAll('[role=\"tab\"]')].some(b => /^Muted 3$/.test(b.textContent.trim()))",
      5000
    );
    await tab(page, "Muted");
    const view = await body(page);
    expect(
      view.includes("keyword “listicle”"),
      "the muted view names the rule"
    );
    expect(
      view.includes("Ten sleep hacks, a listicle (1)"),
      "the muted view lists what it holds"
    );
  },

  // Deferred a third time, the paper drops to Skim and says why.
  async demote(page) {
    await openQueue(page);
    await tile(page, "tmr");
    expect(
      (await selectedTitle(page)) === "Targeted reactivation in naps",
      "the twice-deferred paper is selected"
    );
    await letter(page, "d");
    await page.wait("/Deferred “/.test(document.body.innerText)", 5000);
    await tab(page, "Skim");
    await page.eval(
      `[...document.querySelectorAll('button[id^="skim-line-"]')].find(b => b.innerText.includes('Targeted reactivation in naps')).click()`
    );
    await page.sleep(500);
    const hand = await detail(page);
    console.log(
      `DEMOTED: ${hand.split("\n").filter(Boolean).slice(0, 2).join(" | ")}`
    );
    expect(
      hand.includes("Targeted reactivation in naps") &&
        hand.includes("moved to Skim after three defers"),
      "the card says why it moved"
    );
  },

  // A Skim paper a second Scout found at launch is in Review and says so.
  async raise(page) {
    await openQueue(page);
    await tile(page, "skim");
    const hand = await detail(page);
    console.log(
      `RAISED: ${hand.split("\n").filter(Boolean).slice(0, 2).join(" | ")}`
    );
    expect(
      (await selectedTitle(page)) === "Cueing in the skim lane",
      "the Skim paper is in Review"
    );
    expect(
      hand.includes("raised — also found by Memory replay"),
      "the card says who raised it"
    );
  },

  // ⇧R clears the group on screen; the act says what it did; ⌘Z undoes it as one.
  async bulk(page) {
    await openQueue(page);
    await tile(page, "dreams");
    expect((await rows(page)).length === 4, "four Dream reports are on screen");
    await letter(page, "r", SHIFT);
    await page.wait(
      "!!document.querySelector('[aria-label=\"Undo reject of 4\"]')",
      5000
    );
    expect(
      /Rejected 4 in this group\. ⌘Z puts them all back\./.test(
        await body(page)
      ),
      "the act says what it did and how to take it back"
    );
    expect((await rows(page)).length === 0, "no row is left in the group");
    await letter(page, "z", META);
    await page.wait(
      "document.querySelectorAll('[aria-label=\"New finds\"] li').length === 4",
      5000
    );
  },

  // The same Queue by Question: a paper in every group it belongs to.
  async question(page) {
    await openQueue(page);
    await press(page, "group: scout");
    await page.wait(
      "document.querySelectorAll('[aria-label=\"Questions\"] button').length > 1",
      10000
    );
    const strip = await page.eval(
      `[...document.querySelectorAll('[aria-label="Questions"] button')].map(b => b.innerText.replace(/\\s+/g, ' ').trim())`
    );
    console.log(`QUESTIONS: ${strip.join(" | ")}`);
    expect(
      strip.some((r) => r.startsWith("Does sleep consolidate")),
      "Question one is a group"
    );
    expect(
      strip.some((r) => r.startsWith("Unassigned")),
      "Unassigned is a group"
    );
    const counts = strip.map((r) => Number(r.match(/(\d+)$/)?.[1]));
    expect(
      counts.slice(1).reduce((a, b) => a + b, 0) > counts[0],
      "the groups add up to more than the total, and the page says so"
    );
    expect(
      (await body(page)).includes("A paper can be in several groups"),
      "the page says a paper can be in several groups"
    );
  },
};

export default (page) => {
  const step = steps[process.env.DEMO_STEP];
  if (step === undefined)
    throw new Error(`no demo step ${process.env.DEMO_STEP}`);
  return step(page);
};
