// 3b. Saved: the Scout stays the same Scout and says its new page has not
// been read. The script then checks that nothing ran.
import { writeFileSync } from "node:fs";
import {
  NAME,
  button,
  expect,
  newAddress,
  openFormFromActivity,
  openQueue,
  railText,
  setValue,
} from "./helpers.mjs";
export default async (page) => {
  await openFormFromActivity(page);
  await page.eval(setValue("input[type=url]", newAddress()));
  await page.eval(`${button("Save")}.click()`);
  // A launch checks every due Scout before the drive starts, so the run count
  // alone cannot tell a run Save started from one the launch did; the
  // orchestrator asks for runs begun after this moment.
  writeFileSync(process.env.DEMO_MARK, new Date().toISOString());
  await page.wait("!document.querySelector('input[type=url]')", 10000);
  await openQueue(page);
  await page.wait(
    "document.body.innerText.includes('this page has not been read')",
    10000
  );
  await page.sleep(4000);
  const rail = await railText(page);
  expect(rail.includes(NAME), "it is the same Scout");
  expect(!rail.includes("404"), "the old page's failure is not shown");
  console.log(`RAIL: ${rail}`);
};
