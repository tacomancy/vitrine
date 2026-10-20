// 2. Typing saves, and every byte not typed stays: a CRLF note with no
// trailing newline; then a Working answer typed here adds a Revision.
import { CRLF_BYTES, CRLF_NOTE } from "./vault.mjs";
import {
  clickAt,
  expect,
  line,
  openFile,
  read,
  settle,
  typeAtEnd,
} from "./helpers.mjs";
const RQ =
  "questions/Is the overnight benefit consolidation or encoding (RQ).md";
export default async (page) => {
  const before = read(RQ);
  await openFile(page, CRLF_NOTE);
  await typeAtEnd(page, " — typed here");
  await settle(page);
  expect(
    read(CRLF_NOTE) === `${CRLF_BYTES} — typed here`,
    `only the typed bytes changed, got ${JSON.stringify(read(CRLF_NOTE))}`
  );
  console.log(`2a. CRLF NOTE ON DISK: ${JSON.stringify(read(CRLF_NOTE))}`);

  await openFile(page, RQ);
  await page.wait(`!!${line("Working answer")}`);
  // The empty line under the heading is the Working answer's body.
  await clickAt(page, `${line("Working answer")}.nextElementSibling`);
  await page.type(
    "Mostly consolidation, but encoding strength is not ruled out."
  );
  await settle(page);
  const after = read(RQ);
  expect(
    after.includes("## Working answer\nMostly consolidation") ||
      after.includes("## Working answer\n\nMostly consolidation"),
    "the answer is in the Working answer section"
  );
  const history = after.split("## Position history")[1] ?? "";
  expect(
    history.includes("working answer"),
    `a Revision was recorded under Position history, got ${JSON.stringify(history)}`
  );
  expect(
    !before.split("## Position history")[1].includes("working answer"),
    "none before"
  );
  console.log(`2b. POSITION HISTORY: ${JSON.stringify(history.trim())}`);
};
