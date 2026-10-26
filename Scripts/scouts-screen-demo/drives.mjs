// What a researcher does on the Scouts screen, one function per launch of the
// closing run (#862), chosen by DEMO_STEP. Each throws when the page does not
// show what its step claims, so a green run is the evidence. DEMO_A and DEMO_B
// are the names of the two Scouts the run drops; DEMO_COUNT is how many Scouts
// the snapshot holds.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};
const A = process.env.DEMO_A;
const B = process.env.DEMO_B;
const COUNT = Number(process.env.DEMO_COUNT);

const shoot = async (page, name) => {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    join(process.env.DEMO_OUT, `${name}.png`),
    Buffer.from(data, "base64")
  );
  console.log(`shot ${name}`);
};
const click = (page, selector, text) =>
  page.eval(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !${JSON.stringify(text ?? null)} || e.textContent.trim() === ${JSON.stringify(text ?? "")});
    if (!el) throw new Error('nothing to click: ' + ${JSON.stringify(selector + " " + (text ?? ""))});
    el.click();
  })()`);
const byLabel = (page, label) =>
  page.eval(
    `!!document.querySelector('[aria-label=${JSON.stringify(label)}]')`
  );
const body = (page) => page.eval("document.body.innerText");
const dark = (page) =>
  page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });

/** A page that has stopped changing, so a picture is of the answer and not of the read. */
const settle = async (page) => {
  for (let was = await body(page), i = 0; i < 12; i++) {
    await page.sleep(1500);
    const now = await body(page);
    if (now === was) return;
    was = now;
  }
  throw new Error("demo: the page never settled");
};
const go = async (page, hash, ready) => {
  await dark(page);
  await page.eval(`location.hash=${JSON.stringify(hash)}`);
  await page.wait(ready, 20000);
  await settle(page);
};
const SCREEN_READY = "!!document.querySelector('table[aria-label=\"Scouts\"]')";
const QUEUE_READY =
  "document.querySelectorAll('ul[aria-label=\"Scouts\"] li').length > 0";

const steps = {
  // The Queue shows papers and a rail; its link and a marked Scout's line lead
  // to the Scouts screen.
  async reach(page) {
    await go(page, "#/scouts", QUEUE_READY);
    const entries = await page.eval(
      "document.querySelectorAll('ul[aria-label=\"Scouts\"] > li').length"
    );
    expect(
      entries >= COUNT,
      `the rail lists the ${COUNT} Scouts (saw ${entries})`
    );
    expect(
      await byLabel(page, "Needs you"),
      "a Scout that needs the researcher is named above the list"
    );
    const text = await body(page);
    for (const gone of ["Edit", "Pause", "Resume"])
      expect(
        !(await page.eval(
          `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(gone)})`
        )),
        `the Queue has no ${gone} button`
      );
    expect(
      text.includes("Scouts screen"),
      "the Queue links to the Scouts screen"
    );
    await shoot(page, "1-queue-rail");

    await click(page, "a", "Scouts screen");
    await page.wait(SCREEN_READY, 20000);
    expect(
      (await page.eval("location.hash")).startsWith("#/scout-management"),
      "the Queue's link lands on the Scouts screen"
    );
    await settle(page);
    await shoot(page, "2-scouts-screen");

    await go(page, "#/scouts", QUEUE_READY);
    await page.eval(
      "document.querySelector('[aria-label=\"Needs you\"] a').click()"
    );
    await page.wait(SCREEN_READY, 20000);
    const hash = await page.eval("location.hash");
    expect(
      hash.startsWith("#/scout-management") && hash.includes("scout="),
      `a marked Scout's line lands on its row (${hash})`
    );
    await settle(page);
    await shoot(page, "3-from-the-marker");
  },

  // Two Scouts dropped; each row stays with *undo* until the page is left.
  async drop(page) {
    await go(page, "#/scout-management", SCREEN_READY);
    await click(page, `button[aria-label=${JSON.stringify(`${A}: drop`)}]`);
    await page.wait("document.body.innerText.includes('undo')", 10000);
    await click(page, `button[aria-label=${JSON.stringify(`${B}: drop`)}]`);
    await page.wait(
      "document.querySelectorAll('button').length && [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'undo').length === 2",
      10000
    );
    await settle(page);
    await shoot(page, "4-two-dropped");
  },

  // The first is erased after its question; the dropped line goes to one.
  async erase(page) {
    await go(page, "#/scout-management", SCREEN_READY);
    expect(
      (await body(page)).includes("2 dropped"),
      "two Scouts are on the dropped line"
    );
    await click(page, "button", "2 dropped");
    await click(page, `button[aria-label=${JSON.stringify(`${A}: erase`)}]`);
    await page.wait(`!!document.querySelector('[role="alertdialog"]')`, 5000);
    const ask = await page.eval(
      "document.querySelector('[role=\"alertdialog\"]').innerText"
    );
    expect(
      ask.includes("cannot be undone") && ask.includes("Query"),
      "erase says plainly that the brief is lost"
    );
    await shoot(page, "5-erase-asks");
    await click(page, "button", "erase it");
    await page.wait("document.body.innerText.includes('1 dropped')", 10000);
    await settle(page);
    const text = await body(page);
    expect(!text.includes(A), "the erased Scout is on no line and is no row");
    await shoot(page, "6-erased");
  },

  // A different Scout is restored, beside the rest.
  async restore(page) {
    await go(page, "#/scout-management", SCREEN_READY);
    await click(page, "button", "1 dropped");
    await click(page, `button[aria-label=${JSON.stringify(`${B}: restore`)}]`);
    await page.wait(
      `!!document.querySelector('button[aria-label=${JSON.stringify(`${B}: edit`)}]')`,
      10000
    );
    await settle(page);
    const text = await body(page);
    expect(!/\d+ dropped/.test(text), "nothing is left on the dropped line");
    expect(!text.includes(A), "the erased Scout does not come back");
    await shoot(page, "7-restored");
    await go(page, "#/scouts", QUEUE_READY);
    const names = await page.eval(
      "[...document.querySelectorAll('ul[aria-label=\"Scouts\"] > li')].map(li => li.innerText).join('\\n')"
    );
    expect(
      names.includes(B) && !names.includes(A),
      "the rail has the restored Scout and not the erased one"
    );
    await shoot(page, "8-queue-after");
  },
};

export default async function drive(page) {
  const step = steps[process.env.DEMO_STEP];
  if (!step) throw new Error(`demo: no step ${process.env.DEMO_STEP}`);
  await step(page);
}
