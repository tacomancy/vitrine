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
  // Journal first: the journal's address is the card's link and the arXiv
  // copy follows it as *also on arXiv*, whichever Scout saw the work first.
  const journal = card.indexOf("https://journal.example/w5");
  const arxiv = card.indexOf("https://arxiv.org/abs/2610.00001");
  expect(
    journal !== -1 && arxiv !== -1 && journal < arxiv,
    "the journal link comes before the arXiv one"
  );
  expect(
    card.includes("also on arXiv") && card.includes("arxiv.org/abs/2610.00001"),
    "the arXiv copy is kept"
  );
  expect(
    card.includes("Proceedings of Sleep Science (conference)"),
    "the venue is the journal's, not arXiv's"
  );
};
