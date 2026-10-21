// Opens the hub, shows the Graph tab at 2 hops (both Rings, the overflow, Not
// drawn), then turns the stubs and notes chips off for the second capture.
import { expect } from "../vault-demo/helpers.mjs";
import { HUB } from "./vault.mjs";

const GRAPH = process.env.GRAPH_DEMO_STEP ?? "all";

export default async (page) => {
  await page.eval(
    `location.hash='#/vault/${HUB.split("/").map(encodeURIComponent).join("/")}'`
  );
  await page.wait(
    "!![...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='graph')",
    15000
  );
  await page.eval(
    "[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='graph').click()"
  );
  await page.wait(
    "!!document.querySelector('[aria-label=\"Not shown\"]')",
    15000
  );
  const text = (sel) => `document.querySelector('${sel}')?.innerText`;
  const overflow = await page.eval(text('[aria-label="Not shown"]'));
  const notDrawn = await page.eval(text('[aria-label="Not drawn"]'));
  const dots = await page.eval(
    "document.querySelectorAll('[data-node]').length"
  );
  const rings = await page.eval(
    "new Set([...document.querySelectorAll('[data-node]')].map(n=>Math.round(Math.hypot(n.dataset.x,n.dataset.y)))).size"
  );
  console.log(`OVERFLOW: ${overflow.replace(/\s+/g, " ").slice(0, 120)}`);
  console.log(`NOT DRAWN: ${notDrawn.replace(/\s+/g, " ")}`);
  console.log(`DOTS: ${dots}`);
  expect(/^\+10 more/.test(overflow), "the hub's cut is 10 files");
  expect(/2 not drawn/.test(notDrawn), "Twin and never written are Not drawn");
  expect(rings >= 3, "centre and two Rings are drawn");
  if (GRAPH === "filtered") {
    await page.eval(
      "[...document.querySelectorAll('[aria-label=\"Kinds\"] button')].find(b=>b.textContent.trim().toLowerCase()==='notes').click()"
    );
    await page.sleep(500);
    const after = await page.eval(
      "document.querySelectorAll('[data-node]').length"
    );
    console.log(`DOTS AFTER NOTES OFF: ${after}`);
    expect(after < dots && after > 0, "the notes chip hides dots");
  }
};
