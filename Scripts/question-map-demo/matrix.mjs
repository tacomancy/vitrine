// 1. The matrix with its stated cut, in the theme QM_THEME names.
import {
  applyTheme,
  expect,
  gridSize,
  openMapRead,
  stated,
} from "./helpers.mjs";
/** The styles a theme resolves to, quoted in the PR (docs/agents/run.md § 3). */
const tokens = (page) =>
  page.eval(`(() => {
    const css=getComputedStyle(document.documentElement);
    const cell=document.querySelector('[role=gridcell][aria-label]:not([aria-label$=": 0 items"])');
    return {
      seq1: css.getPropertyValue('--color-seq-1').trim(),
      seq5: css.getPropertyValue('--color-seq-5').trim(),
      page: getComputedStyle(document.body).backgroundColor,
      cell: cell && getComputedStyle(cell).backgroundColor,
    };
  })()`);

export default async (page) => {
  await openMapRead(page);
  await applyTheme(page);
  const size = await gridSize(page);
  const line = await stated(page);
  console.log(
    `THEME ${process.env.QM_THEME ?? "default"}:`,
    line,
    JSON.stringify(size),
    JSON.stringify(await tokens(page))
  );
  expect(
    size.rows === 24 && size.columns === 22,
    `24 × 22, got ${JSON.stringify(size)}`
  );
  expect(
    /30 questions · 25 tags · matrix shows the 24 × 22 heaviest/.test(line),
    `the cut is stated: ${line}`
  );
};
