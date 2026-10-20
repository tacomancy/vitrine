// 6. Full-text search: the matching line, the term marked, ↵ opens it.
import { expect } from "./helpers.mjs";
export default async (page) => {
  await page.eval("location.hash='#/vault'");
  await page.wait("!!document.querySelector('#vault-tab-search')", 15000);
  await page.eval("document.querySelector('#vault-tab-search').click()");
  await page.wait(
    "!!document.querySelector('[aria-label=\"Search the vault\"]')",
    15000
  );
  await page.eval(
    "document.querySelector('[aria-label=\"Search the vault\"]').focus()"
  );
  await page.type("slow-wave");
  await page.wait(
    "!!document.querySelector('[aria-label=\"Search results\"] [role=option]')",
    15000
  );
  const hits = await page.eval(
    "[...document.querySelectorAll('[aria-label=\"Search results\"] [role=option]')].map(o=>o.innerText.replace(/\\s+/g,' '))"
  );
  console.log(`6. HITS: ${hits.join(" | ")}`);
  expect(
    hits.some((h) => h.includes("Sleep and consolidation")),
    "the note is found"
  );
  expect(
    (await page.eval(
      "document.querySelectorAll('[aria-label=\"Search results\"] mark').length"
    )) > 0,
    "the term is marked"
  );
  await page.key("ArrowDown", { code: "ArrowDown", vk: 40 });
  await page.key("Enter", { code: "Enter", vk: 13, text: "\r" });
  await page.wait("location.hash.startsWith('#/vault/')", 10000);
  console.log(
    `6. OPENED: ${await page.eval("decodeURIComponent(location.hash)")}`
  );
};
