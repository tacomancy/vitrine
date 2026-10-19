// 6. The next sync re-measured the pending Tag: no failure, nothing pending.
// AD_THEME renders it in each of tokens.css's theme states.
import {
  bring,
  applyTheme,
  expect,
  openMap,
  openPanel,
  panelText,
} from "./helpers.mjs";
export default async (page) => {
  await openMap(page);
  await openPanel(page);
  await page.wait(
    `document.querySelectorAll('[role=option][aria-label*="growth"]').length>=5`
  );
  await page.sleep(6000); // the sync on open measures the pending Tag
  await applyTheme(page, process.env.AD_THEME);
  const panel = await panelText(page);
  console.log("THEME", process.env.AD_THEME, ":", panel.replace(/\n+/g, " | "));
  if (process.env.AD_THEME === "dark") {
    expect(!panel.includes("re-measure pending"), "nothing is pending now");
    expect(!/answered with an error/.test(panel), "the failure line is gone");
  }
  console.log(
    "STYLES:",
    JSON.stringify(
      await page.eval(`(() => {
        const css=getComputedStyle(document.documentElement);
        const dot=document.querySelector('[role=option] circle');
        return { page: getComputedStyle(document.body).backgroundColor, accent: css.getPropertyValue('--color-accent').trim(), fill: dot && getComputedStyle(dot).fill };
      })()`)
    )
  );
  await bring(page);
};
