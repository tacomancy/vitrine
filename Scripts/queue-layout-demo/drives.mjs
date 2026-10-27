// What the layout check (#871) measures in the one launch: the Queue at 1280px
// with the rail collapsed and open, then as the window narrows. It throws when
// the abstract's line is not readable at 1280px or the layout does not cross
// where the threshold says; a green run is the evidence.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};
const shoot = async (page, name) => {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(process.env.DEMO_OUT, name), Buffer.from(data, "base64"));
  console.log(`shot ${name}`);
};
const resize = async (page, width) => {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.sleep(600);
};
const body = (page) => page.eval("document.body.innerText");
const button = (page, label) =>
  page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!b) throw new Error('no button ' + ${JSON.stringify(label)});
    b.click();
  })()`);

// What each pane was given, and the characters the abstract's width holds.
const measure = (page) =>
  page.eval(`(() => {
    const px = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
    const surface = document.querySelector('[data-layout]');
    const abstract = document.querySelector('p[class*="abstract"]');
    // The fixture abstracts are one or two lines, so count what a line of the
    // abstract's own font would hold in the width it has been given.
    let chars = null;
    if (abstract) {
      const style = getComputedStyle(abstract);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = style.fontSize + ' ' + style.fontFamily;
      const sample = 'the quick brown fox jumps over a lazy dog while reading papers ';
      chars = Math.round(abstract.getBoundingClientRect().width / (ctx.measureText(sample).width / sample.length));
    }
    const rail = document.querySelector('ul[aria-label="Scouts"]');
    return {
      layout: surface?.dataset.layout,
      queue: px(surface),
      railHeight: rail ? Math.round(rail.getBoundingClientRect().height) : null,
      railNames: rail ? rail.innerText.length : null,
      list: px(document.querySelector('[class*="listPane"]')),
      detail: px(document.querySelector('[class*="detailPane"]')),
      abstractWidth: px(abstract),
      chars,
    };
  })()`);

export default async function (page) {
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await resize(page, 1280);
  await page.eval("location.hash='#/scouts'");
  await page.wait("!!document.querySelector('#scout-rail-sleep')", 20000);
  // Let the launch's due Scouts answer and the page stop changing.
  for (let was = await body(page), i = 0; ; i++) {
    expect(i < 12, "the Queue never settled");
    await page.sleep(2500);
    const now = await body(page);
    if (now === was) break;
    was = now;
  }

  const rows = [];
  const row = async (label) => {
    const m = await measure(page);
    rows.push({ label, ...m });
    console.log(`MEASURE ${label} ${JSON.stringify(m)}`);
    return m;
  };

  const open = await row("1280 rail open");
  await button(page, "Collapse the rail");
  await page.sleep(400);
  const collapsed = await row("1280 rail collapsed");
  await shoot(page, "1-1280-rail-collapsed.png");

  expect(collapsed.layout === "wide", "1280px is the wide layout");
  expect(
    collapsed.chars >= 55 && collapsed.chars <= 85,
    `the abstract keeps a readable line at 1280px (${collapsed.chars} characters)`
  );
  expect(
    collapsed.railHeight <= open.railHeight,
    "the collapsed rail takes no more room than the open one"
  );
  expect(
    collapsed.detail > collapsed.list,
    "the detail has the larger share when wide"
  );

  // Narrowing: the Queue's width is the window less the 238px sidebar.
  for (const width of [1230, 1220, 1100, 1000]) {
    await resize(page, width);
    await row(`${width} rail collapsed`);
  }
  await resize(page, 1280);
  await button(page, "Open the rail");
  await resize(page, 1100);
  await row("1100 rail open");
  await shoot(page, "2-1100-rail-open.png");
  await resize(page, 1000);
  await row("1000 rail open");

  // The Queue is the window less the sidebar and the gutters (262px here), so
  // WIDE_FROM = 960 is crossed between 1220 and 1230.
  const rowOf = (label) => rows.find((r) => r.label === label);
  expect(
    rowOf("1230 rail collapsed").layout === "wide" &&
      rowOf("1220 rail collapsed").layout === "narrow",
    "the layout crosses at a Queue width of 960px"
  );

  // Below the threshold the panes stack and the paper opens in its row.
  await resize(page, 1100);
  await button(page, "Collapse the rail");
  await resize(page, 900);
  const narrow = await row("900 rail collapsed");
  expect(narrow.layout === "narrow", "900px stacks the panes");
  expect(narrow.detail === null, "no separate detail pane exists when stacked");
  await shoot(page, "3-900-stacked.png");

  writeFileSync(
    join(process.env.DEMO_OUT, "measurements.json"),
    JSON.stringify(rows, null, 2) + "\n"
  );
}
