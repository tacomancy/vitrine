// Step 3: open the Source in the Reader, select a passage on the page and
// press ⌘' — the Question is made, and a `Q:` highlight is written into the
// PDF for the next viewer. Ends with the highlight drawn on the page.
export default async (page) => {
  await page.eval("location.hash='#/source/sources/klinzing2019.md'");
  await page.wait(
    "[...document.querySelectorAll('[data-page] span')].some(s=>s.textContent.includes('Sleep spindles'))",
    20000
  );
  await page.eval(`(() => {
    const span = [...document.querySelectorAll('[data-page] span')].find(s=>s.textContent.includes('Sleep spindles'));
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('[data-testid=pdf-scroller]').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  })()`);
  await page.sleep(300);
  await page.key("'", { code: "Quote", vk: 222, modifiers: 4 });
  await page.wait(
    "!!document.querySelector('form[aria-label=Capture] input, [role=textbox][aria-label=Question]')"
  );
  console.log(
    `CAPTURE LINE: ${await page.eval("document.querySelector('form[aria-label=Capture]')?.innerText")}`
  );
  await page.type("Are spindles counted the same way in every night?");
  await page.key("Enter", { vk: 13, text: "\r" });
  await page.wait("!document.querySelector('form[aria-label=Capture]')", 15000);
  await page.sleep(2500);
};
