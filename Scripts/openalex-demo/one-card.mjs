// 5. An arXiv Scout and an OpenAlex Scout both found "Slow Oscillations
// Reconsidered": one card, the journal's link first, the arXiv copy beside it
// as *also on arXiv*.
import { expect, openQueue } from "./helpers.mjs";
export default async (page) => {
  await openQueue(page);
  await page.wait(
    "document.body.innerText.includes('Slow Oscillations Reconsidered')",
    30000
  );
  // Both Scouts have run before the window is listening; let the rail settle.
  await page.sleep(4000);
  const cards = await page.eval(
    "[...document.querySelectorAll('article')].filter(a=>a.getAttribute('aria-label')==='Slow Oscillations Reconsidered').length"
  );
  expect(cards === 1, `one card, got ${cards}`);
  const card = await page.eval(
    "document.querySelector('article[aria-label=\"Slow Oscillations Reconsidered\"]').innerText"
  );
  console.log(`CARD: ${card.replace(/\n+/g, " | ")}`);
  expect(
    card.includes("Sleep preprints") && card.includes("Sleep published"),
    "both Scouts are named"
  );
  expect(
    card.includes("https://journal.example/w5"),
    "the journal link is the link"
  );
  expect(
    card.includes("also on arXiv") && card.includes("arxiv.org/abs/2610.00001"),
    "the arXiv copy is kept"
  );
  expect(
    card.includes("conference") ||
      card.includes("Proceedings of Sleep Science"),
    "the venue is the journal's"
  );
};
