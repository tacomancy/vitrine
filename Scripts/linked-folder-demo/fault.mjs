// Step 3: the link's target is gone, and the app relaunched.
import { expect, footer, looseEnds } from "./helpers.mjs";
export default async (page) => {
  await page.wait(
    "document.body.innerText.includes('papers not arriving')",
    20000
  );
  const foot = await footer(page);
  const text = await looseEnds(page);
  console.log(`FOOTER: ${foot}`);
  expect(
    foot.split("papers not arriving").length === 2,
    "the footer says papers not arriving once",
    foot
  );
  expect(
    text.includes("stray.pdf"),
    "Loose Ends rendered, its rows kept",
    text
  );
  expect(
    !text.includes("PDF missing"),
    "Loose Ends has no PDF missing row",
    text
  );
};
