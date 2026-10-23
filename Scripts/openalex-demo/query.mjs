// 1. An OpenAlex Scout by Query: Try answers with the total, the first titles
// and the credits left; then saved.
import {
  expect,
  newOpenAlexScout,
  save,
  tryIt,
  typeQuery,
} from "./helpers.mjs";
export default async (page) => {
  await newOpenAlexScout(page, "Probe papers");
  await typeQuery(page, "probe");
  await tryIt(page, "results across journals and conferences in OpenAlex");
  const text = await page.eval("document.body.innerText");
  expect(/4 results across journals/.test(text), "Try says the total");
  expect(/912 credits left today/.test(text), "Try says the credits left");
  expect(
    text.includes("Linear probes recover steering directions"),
    "Try lists titles"
  );
  expect(
    text.includes("OpenAlex searches journals and conferences only"),
    "the form says a preprint will not appear"
  );
  await save(page);
};
