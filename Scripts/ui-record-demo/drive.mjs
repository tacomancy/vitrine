// One launch of the beat 13 record (#793): visits every surface in the theme
// UI_THEME names and writes a PNG of each into UI_OUT, named for the
// prototype it is read beside. The hidden snapshot captures once per launch,
// so the drive takes its own with Page.captureScreenshot.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SURFACES = [
  ["01-question-inbox", "#/inbox"],
  ["02-reader", "#/source/sources/rasch2013.md"],
  [
    "03-research-question-view",
    "#/research-question/questions/Is the overnight benefit consolidation or encoding (RQ).md",
  ],
  [
    "04-hypothesis-view",
    "#/hypothesis/hypotheses/Slow-wave density on the retention night predicts overnight recall gain beyond.md",
  ],
  [
    "05-experiment-view",
    "#/experiment/experiments/overnight-vs-wake/overnight-vs-wake.md",
  ],
  ["06-scout-queue", "#/scouts"],
  ["06b-new-scout-form", "#/scouts", "new-scout"],
  ["07-vault", "#/vault/Sleep and consolidation.md"],
  ["08-home", "#/home"],
  ["09-loose-ends", "#/loose-ends"],
  ["10-scout-activity", "#/scout-activity"],
  ["11-question-map", "#/question-map"],
  ["13-settings", "#/settings"],
];

const shoot = async (page, name) => {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    join(process.env.UI_OUT, `${name}-${process.env.UI_THEME}.png`),
    Buffer.from(data, "base64")
  );
  console.log(`shot ${name}-${process.env.UI_THEME}`);
};

export default async (page) => {
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: process.env.UI_THEME }],
  });
  if (process.env.UI_STEP === "first-run") {
    await page.sleep(1500);
    return shoot(page, "12-empty-vault");
  }
  for (const [name, hash, extra] of SURFACES) {
    await page.eval(`location.hash=${JSON.stringify(hash)}`);
    await page.sleep(name === "06b-new-scout-form" ? 500 : 3000);
    if (extra === "new-scout") {
      await page.eval(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ New Scout').click()`
      );
      await page.wait(
        "!!document.querySelector('form[aria-label=\"New Scout\"]')"
      );
      await page.sleep(500);
    }
    await shoot(page, name);
  }
};
