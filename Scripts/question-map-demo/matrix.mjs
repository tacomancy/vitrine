// 1. The matrix with its stated cut, in the theme QM_THEME names.
import {
  applyTheme,
  expect,
  gridSize,
  openMapRead,
  stated,
  tokens,
} from "./helpers.mjs";
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
