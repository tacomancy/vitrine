// 4. A cadence from a three-option menu, and the menu says what it would cause.
import { click, expect, openActivity } from "./helpers.mjs";
export default async (page) => {
  await openActivity(page);
  await click(page, "Sleep and consolidation: cadence, weekly");
  await page.wait("!!document.querySelector('[role=menu]')");
  const menu = await page.eval(
    "document.querySelector('[role=menu]').innerText"
  );
  console.log(`MENU: ${menu.replace(/\s+/g, " ")}`);
  expect(
    /daily · due at the next check/.test(menu),
    "a shorter cadence says it is due"
  );
  expect(!/monthly · due/.test(menu), "a longer one does not");
  await page.eval(
    "[...document.querySelectorAll('[role=menuitemradio]')].find(b=>b.textContent.startsWith('daily')).click()"
  );
  await page.wait(
    "!!document.querySelector('[aria-label=\"Sleep and consolidation: cadence, daily\"]')"
  );
  await page.sleep(800);
  console.log(`CADENCE NOW: daily`);
};
