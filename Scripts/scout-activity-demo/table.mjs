// 1. The fleet in need-order, and nothing painted a judgement.
import { expect, names, openActivity, rowText } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page);
  const order = await names(page);
  console.log(`ORDER: ${order.join(" | ")}`);
  const at = (name) => order.indexOf(name);
  // Faults first, then Scouts not looking, then accept rate ascending, and
  // *nothing triaged* last (ADR 0042 decision 5).
  expect(order[0] === "Odour cueing", "the broken Scout is first");
  const notLooking = ["Nap studies (paused)", "Sleep lab publications page"];
  for (const name of notLooking)
    expect(at(name) >= 1 && at(name) <= 3, `${name} follows the fault`);
  const rated = [
    "Dream reports",
    "Stale topic",
    "Hippocampal ripples",
    "Memory replay",
    "Sleep and consolidation",
    "Sleep spindles",
  ];
  rated.reduce((before, name) => {
    expect(at(name) > before, `${name} follows a lower accept rate`);
    return at(name);
  }, at(notLooking[1]));
  for (const name of [
    "Glymphatic clearance",
    "Sleep, skim only",
    "Targeted memory reactivation",
  ])
    expect(at(name) > at("Sleep spindles"), `${name} is among the last`);
  console.log(
    `FIRST ROW: ${(await rowText(page, "Odour cueing")).replace(/\s+/g, " ")}`
  );
  console.log(
    `PAUSED: ${(await rowText(page, "Nap studies (paused)")).replace(/\s+/g, " ")}`
  );
  console.log(
    `KEY: ${(await rowText(page, "Sleep lab publications page")).replace(/\s+/g, " ")}`
  );
  console.log(
    `QUIET: ${(await rowText(page, "Targeted memory reactivation")).replace(/\s+/g, " ")}`
  );
  // Story 9: the poorest accept rate and the best are one colour.
  const colour = (name) =>
    page.eval(
      `(() => { const r=[...document.querySelectorAll('table[aria-label="Scouts"] tbody tr')].find(r=>r.querySelector('th')?.innerText.startsWith(${JSON.stringify(name)})); return [...r.querySelectorAll('td')].map(c=>getComputedStyle(c).color+'|'+getComputedStyle(c).backgroundColor).join(' ; ') })()`
    );
  const poor = await colour("Dream reports");
  const good = await colour("Sleep spindles");
  console.log(`POOR ROW COLOURS: ${poor}\nGOOD ROW COLOURS: ${good}`);
  expect(poor === good, "a poor accept rate is painted like a good one");
  console.log(
    `HEADER: ${await page.eval("document.querySelector('[aria-label=\"Source health\"]').innerText")}`
  );
};
