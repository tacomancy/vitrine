// 3a. On the form the Address is edited and *try* reads the new page; the
// sentence under the field says what saving it will do.
import {
  button,
  storeKey,
  expect,
  newAddress,
  openFormFromActivity,
  setValue,
} from "./helpers.mjs";
export default async (page) => {
  await storeKey(page, "sk-demo-good");
  await openFormFromActivity(page);
  await page.eval(setValue("input[type=url]", newAddress()));
  await page.eval(`${button("Try")}.click()`);
  await page.wait("!!document.querySelector('form [role=status]')", 15000);
  const form = await page.eval("document.querySelector('form').innerText");
  expect(
    form.includes("everything it lists arrives as Retroactive"),
    "the form says what a change does"
  );
  expect(form.includes("make a new Scout"), "Watching says why it is disabled");
  console.log(`FORM: ${form}`);
};
