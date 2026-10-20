// 3. A file whose shape typing broke still saves, and says so on its own
// surface: a second `## Working answer` typed into the Research Question.
import { clickAt, expect, line, openFile, read, settle } from "./helpers.mjs";
const RQ =
  "questions/Is the overnight benefit consolidation or encoding (RQ).md";
export default async (page) => {
  await openFile(page, RQ);
  await page.wait(`!!${line("Supporting sources")}`);
  // The empty line under the heading is in view; a second heading goes there.
  await clickAt(page, `${line("Supporting sources")}.nextElementSibling`);
  await page.type("## Working answer");
  await settle(page);
  expect(
    read(RQ).split("## Working answer").length === 3,
    `the file with a duplicated section was saved anyway, tail ${JSON.stringify(read(RQ).slice(-250))}`
  );
  await page.eval(
    `location.hash='#/research-question/${RQ.split("/").map(encodeURIComponent).join("/")}'`
  );
  await page.wait("document.body.innerText.includes('could not show')", 15000);
  console.log(
    `3. FOOTER: ${await page.eval("[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.includes('could not show')).map(e=>e.textContent).join(' | ')")}`
  );
};
