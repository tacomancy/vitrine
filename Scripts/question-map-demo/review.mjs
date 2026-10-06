// 4. The inferred-link review, entered from an unanchored row. QM_STEP:
//   accept   A on the first Question's first paper; its row gains a cell
//   reject   R on the second Question; *Undo reject* offered
//   remembered  a new launch: the rejected pair is not offered again
//   undo     R then ⌘Z; the pair is back
//   pass     P; the candidate returns to the bottom of the stack
import { expect, openMapRead, press } from "./helpers.mjs";
const names = () =>
  `[...document.querySelectorAll('[aria-label="Papers sharing a Tag with this question"] [role=option] span:first-child')].map(s=>s.textContent)`;
const enter = async (page, question) => {
  await openMapRead(page);
  await page.eval(
    `document.querySelectorAll('[data-slot=readings] section > button')[1].click()`
  );
  await page.wait(
    `!!document.querySelector('button[aria-label="review links for ${question}?"]')`
  );
  await page.eval(
    `document.querySelector('button[aria-label="review links for ${question}?"]').click()`
  );
  await page.wait(
    `document.querySelectorAll('[aria-label="Papers sharing a Tag with this question"] [role=option]').length>0`
  );
  return page.eval(names());
};
export default async (page) => {
  const [q1, q2] = process.env.QM_QUESTIONS.split("|");
  const step = process.env.QM_STEP;
  if (step === "accept") {
    const offered = await enter(page, q1);
    console.log("OFFERED:", JSON.stringify(offered));
    await press(page, "a");
    await page.wait(`!document.querySelector('[role=alert]')`);
    await page.sleep(1500);
    const stillOffered = await page.eval(names());
    console.log("AFTER ACCEPT:", JSON.stringify(stillOffered));
    expect(
      !stillOffered.includes(offered[0]),
      "the accepted paper leaves the stack"
    );
    // The Question now has Material, so its row (if the cut keeps it) has a cell.
    const row = `[...document.querySelectorAll('[role=grid] [role=row]')].find(r=>r.querySelector('[role=rowheader]')?.textContent.includes(${JSON.stringify(q1)}))`;
    await page.wait(`!!${row}`, 8000);
    const cells = await page.eval(
      `[...${row}.querySelectorAll('[role=gridcell]')].filter(c=>!c.getAttribute('aria-label').endsWith(': 0 items')).map(c=>c.getAttribute('aria-label'))`
    );
    console.log("ROW CELLS:", JSON.stringify(cells));
    expect(cells.length > 0, "the accepted Question's row gained a cell");
    return;
  }
  const offered = await enter(page, q2);
  console.log(`${step.toUpperCase()} offered:`, JSON.stringify(offered));
  if (step === "reject") {
    await press(page, "r");
    await page.wait(
      `!![...document.querySelectorAll('button')].find(b=>b.textContent==='Undo reject')`
    );
  } else if (step === "remembered") {
    expect(
      offered.length === 2,
      `a rejected pair stays gone after a relaunch: ${offered}`
    );
  } else if (step === "undo") {
    await press(page, "r");
    await page.wait(
      `!![...document.querySelectorAll('button')].find(b=>b.textContent==='Undo reject')`
    );
    await page.key("z", { code: "KeyZ", vk: 90, modifiers: 4 });
    await page.wait(
      `!([...document.querySelectorAll('button')].find(b=>b.textContent==='Undo reject'))`
    );
    const back = await page.eval(names());
    console.log("AFTER UNDO:", JSON.stringify(back));
    expect(
      back.length === offered.length,
      "undo returns the pair to the stack"
    );
  } else if (step === "pass") {
    await press(page, "p");
    await page.sleep(300);
    const after = await page.eval(names());
    console.log("AFTER PASS:", JSON.stringify(after));
    expect(
      after.at(-1) === offered[0],
      "a passed candidate returns to the bottom"
    );
  }
};
