// 5. The tag tree: inclusive and this-level counts, a parent's files, and the
// tag the grammar refuses named with its file.
import { expect } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/vault'");
  await page.wait("!!document.querySelector('#vault-tab-tags')", 15000);
  await page.eval("document.querySelector('#vault-tab-tags').click()");
  await page.wait(
    "!!document.querySelector('[aria-label=\"Tags\"] [role=treeitem]')",
    15000
  );
  const row = (name) =>
    `[...document.querySelectorAll('[aria-label="Tags"] [role=treeitem]')].find(r=>r.getAttribute('aria-label').startsWith(${JSON.stringify(name + ",")}))`;
  const memory = await page.eval(
    `${row("memory")}?.getAttribute('aria-label')`
  );
  console.log(`5. MEMORY: ${memory}`);
  const [, inclusive, exclusive] =
    /(\d+) in all, (\d+) at this level/.exec(memory ?? "") ?? [];
  expect(
    Number(inclusive) > Number(exclusive),
    "a parent shows its inclusive count apart from its own"
  );
  await page.eval(`${row("memory")}.click()`);
  await page.wait(
    "!!document.querySelector('[aria-label^=\"Files tagged\"]')",
    10000
  );
  const files = await page.eval(
    "document.querySelector('[aria-label^=\"Files tagged\"]').innerText"
  );
  console.log(`5. FILES: ${files.replace(/\s+/g, " ")}`);
  expect(
    files.includes("Reading log"),
    "the parent lists its descendants' files"
  );
  await page.wait(
    "!!document.querySelector('[aria-label=\"Invalid tags\"]')",
    15000
  );
  const invalid = await page.eval(
    "document.querySelector('[aria-label=\"Invalid tags\"]').innerText"
  );
  console.log(`5. INVALID: ${invalid.replace(/\s+/g, " ")}`);
  expect(
    invalid.includes("2024") && invalid.includes("Lab chatter"),
    "the refused tag is named"
  );
};
