// 4. A venue and a publisher muted by name search: the Scout's cards exist
// first (Run now), then each rule is found by name, its reach counted before
// it is saved, and the muted view holds what it caught.
import { button, expect, openQueue, runNow } from "./helpers.mjs";

const search = async (page, kind, name) => {
  await page.wait(
    `[...document.querySelectorAll('label')].some(l=>l.textContent.trim()===${JSON.stringify(kind)})`,
    10000
  );
  await page.eval(
    `[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(kind)}).querySelector('input').click()`
  );
  await page.eval(
    `(() => { const f=[...document.querySelectorAll('form')].find(f=>/mute by name/i.test(f.innerText)); f.querySelector('input[type=text]').focus(); })()`
  );
  await page.type(name);
  await page.eval(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Search').click()`
  );
  await page.wait(
    "!!document.querySelector('ul[aria-label=\"Results\"]')",
    15000
  );
};

export default async (page) => {
  await openQueue(page);
  await runNow(page, "Probe papers");
  // A launch has already run the Scout once, so this run may find nothing new;
  // either way the run has answered and the cards are in the stack.
  await page.wait("/\\d+ new/.test(document.body.innerText)", 20000);

  await page.eval(`${button("Mute by name")}.click()`);
  await search(page, "Venue", "Probing");
  await page.eval(
    `document.querySelector('button[aria-label^="Mute Transactions on Probing"]').click()`
  );
  await page.wait(
    "document.body.innerText.includes('Saving it would mute')",
    10000
  );
  await page.eval(`${button("Save rule")}.click()`);
  await page.wait("document.body.innerText.includes('Muted venue')", 10000);

  await page.eval(`${button("Mute by name")}.click()`);
  await search(page, "Publisher", "Press");
  await page.eval(
    `document.querySelector('button[aria-label^="Mute Press Seven"]').click()`
  );
  await page.wait(
    "document.body.innerText.includes('Saving it would mute')",
    10000
  );
  await page.eval(`${button("Save rule")}.click()`);
  await page.wait("document.body.innerText.includes('Muted publisher')", 10000);

  await page.wait(
    "[...document.querySelectorAll('button')].some(b=>/\\d+ muted/.test(b.textContent))"
  );
  await page.eval(
    `[...document.querySelectorAll('button')].find(b=>/\\d+ muted/.test(b.textContent)).click()`
  );
  await page.wait("!!document.querySelector('ul[aria-label=\"Mute rules\"]')");
  const rules = await page.eval(
    "document.querySelector('ul[aria-label=\"Mute rules\"]').innerText"
  );
  const held = await page.eval(
    "document.querySelector('ul[aria-label=\"Muted\"]').innerText"
  );
  console.log(
    `RULES: ${rules.replace(/\n+/g, " | ")}\nMUTED: ${held.replace(/\n+/g, " | ")}`
  );
  expect(
    rules.includes("by ID S2") && rules.includes("by ID P1"),
    "each rule keeps its OpenAlex ID beside its name"
  );
  // The four works come from S1/S3 (Press Seven) and S2 (Acme): all muted.
  expect(
    held.includes("What a probe cannot see") &&
      held.includes("Linear probes recover steering directions"),
    "the muted view holds what each rule caught"
  );
};
