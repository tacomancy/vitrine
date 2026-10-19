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
  // rail changes as each answers: quiet is the page saying the same twice.
  for (let was = await body(page), i = 0; i < 12; i++) {
    await page.sleep(2500);
    const now = await body(page);
    if (now === was) return;
    was = now;
  }
  throw new Error("demo: the Queue never settled");
}

const choose = async (page, id) => {
  await page.eval(`document.querySelector('#scout-rail-${id}').click()`);
  await page.sleep(500);
};

const stackTitles = (page) =>
  page.eval(
    `[...document.querySelectorAll('[aria-label="Next in the stack"] li')].map(li => li.innerText.trim())`
  );
const handTitle = (page) =>
  page.eval(`document.querySelector('article h2')?.innerText ?? ''`);

export const steps = {
  // Rank puts the paper by an author the vault has accepted from first and
  // says why; the counterweight slot's paper is second and says what it is.
  async rank(page) {
    await openQueue(page);
    await choose(page, "sleep");
    expect(
      (await page.eval(
        `document.querySelector('[aria-label="Sort"] [aria-pressed="true"]').innerText`
      )) === "Rank",
      "Rank is the default sort"
    );
    const hand = await page.eval(`document.querySelector('article').innerText`);
    expect(
      hand.includes("Spindle-locked replay predicts overnight gain"),
      "the arrival by Jan Born is first"
    );
    expect(
      /by Jan Born, whose work you have accepted/.test(hand),
      "the card names the signal that raised it"
    );
    const next = await stackTitles(page);
    console.log(
      `RANK: ${await handTitle(page)} | ${next.slice(0, 3).join(" | ")}`
    );
    expect(
      next[0]?.startsWith("Cortical spindles across species"),
      "the corroborated paper is second"
    );
    expect(next[0]?.includes("outside the usual"), "the slot says what it is");
    expect(
      next.filter((t) => t.includes("outside the usual")).length === 1,
      "one slot, not several"
    );
    // Newest is one control away and carries no slot.
    await press(page, "Newest");
    await page.sleep(500);
    const newest = [await handTitle(page), ...(await stackTitles(page))];
    console.log(`NEWEST: ${newest.slice(0, 4).join(" | ")}`);
    expect(
      !newest.some((t) => t.includes("outside the usual")),
      "Newest carries no slot"
    );
    expect(
      newest.length === (await stackTitles(page)).length + 1,
      "the same cards, reordered"
    );
    await press(page, "Rank");
    await page.sleep(500);
  },

  // The two past-window papers sit behind one line, still counted.
  async digest(page) {
    await openQueue(page);
    await choose(page, "sleep");
    const text = await body(page);
    expect(
      /2 older than the window/.test(text),
      "the digest line counts the two aged papers"
    );
    expect(
      !text.includes("An older sleep paper (1)"),
      "aged papers are not in the stack"
    );
    await press(page, "2 older than the window");
    await page.sleep(400);
    const open = await body(page);
    expect(
      open.includes("An older sleep paper (1)") &&
        open.includes("An older sleep paper (2)"),
      "the digest opens to both"
    );
  },

  // The Cap kept two of four, said so, and gave the rest back on a click.
  async cap(page) {
    await openQueue(page);
    await choose(page, "sleep");
    expect(
      /2 below your cap of 2/.test(await body(page)),
      "the Cap says what it cut"
    );
    const count = async () => (await body(page)).match(/card 1 of (\d+)/)?.[1];
    const before = await count();
    await press(page, "Show them");
    await page.wait("!/below your cap/.test(document.body.innerText)", 5000);
    const after = await count();
    console.log(`CAP: card 1 of ${before} -> card 1 of ${after}`);
    expect(
      Number(after) === Number(before) + 2,
      "the two come back into the stack"
    );
    const all = [await handTitle(page), ...(await stackTitles(page))].join("|");
    expect(
      all.includes("Slow-wave amplitude and word-pair recall") &&
        all.includes("Napping and the fate of weak memories"),
      "the two capped papers are in the stack"
    );
  },

  // A keyword rule: its reach before it is saved, then the muted view.
  async mute(page) {
    await openQueue(page);
    await choose(page, "sleep");
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
    await page.wait(
      "[...document.querySelectorAll('button')].some(b => /^3 muted$/.test(b.textContent.trim()))",
      5000
    );
    await press(page, "3 muted");
    await page.sleep(500);
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
    await choose(page, "tmr");
    expect(
      (await handTitle(page)) === "Targeted reactivation in naps",
      "the twice-deferred paper is in hand"
    );
    await letter(page, "d");
    await page.sleep(1000);
    await press(page, "Skim");
    await page.sleep(600);
    await page.eval(
      `[...document.querySelectorAll('button[id^="skim-line-"]')].find(b => b.innerText.includes('Targeted reactivation in naps')).click()`
    );
    await page.sleep(500);
    const hand = await page.eval(`document.querySelector('article').innerText`);
    console.log(`DEMOTED: ${hand.split("\n")[0]}`);
    expect(
      hand.includes("moved to Skim after three defers"),
      "the card says why it moved"
    );
  },

  // A Skim paper a second Scout found at launch is in Review and says so.
  async raise(page) {
    await openQueue(page);
    await choose(page, "skim");
    const hand = await page.eval(
      `document.querySelector('article')?.innerText ?? ''`
    );
    console.log(`RAISED: ${hand.split("\n")[0]}`);
    expect(
      hand.includes("Cueing in the skim lane"),
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
    await choose(page, "dreams");
    expect(
      /card 1 of 4/.test(await body(page)),
      "four Dream reports are on screen"
    );
    await letter(page, "r", SHIFT);
    await page.wait(
      "[...document.querySelectorAll('button')].some(b => /^Undo reject of 4$/.test(b.textContent.trim()))",
      5000
    );
    expect(
      !(await body(page)).includes("card 1 of"),
      "no card is left in the group"
    );
    await letter(page, "z", META);
    await page.wait("/card 1 of 4/.test(document.body.innerText)", 5000);
  },

  // The same stack by Question: a paper in every group it belongs to.
  async question(page) {
    await openQueue(page);
    await press(page, "Question");
    await page.wait(
      "document.querySelectorAll('[aria-label=\"Questions\"] button').length > 1",
      10000
    );
    const rail = await page.eval(
      `[...document.querySelectorAll('[aria-label="Questions"] button')].map(b => b.innerText.replace(/\\s+/g, ' '))`
    );
    console.log(`QUESTIONS: ${rail.join(" | ")}`);
    expect(
      rail.some((r) => r.startsWith("Does sleep consolidate")),
      "Question one is a group"
    );
    expect(
      rail.some((r) => r.startsWith("Unassigned")),
      "Unassigned is a group"
    );
    const counts = rail.map((r) => Number(r.match(/(\d+)$/)?.[1]));
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
