// Step 2, before: Loose Ends holding the three Unmatched rows the re-save left.
export default async (page) => {
  await page.eval("location.hash='#/loose-ends'");
  await page.wait(
    "document.body.innerText.includes('annotation · unmatched')",
    20000
  );
  await page.sleep(1500);
};
