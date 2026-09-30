// Step 1: a PDF no Source names is attached to a stub from Loose Ends, and
// the first Ingest reads its annotations. Ends on the Inbox, where the `Q:`
// highlights have become Questions; the footer line is printed as it stood.
export default async (page) => {
  await page.eval("location.hash='#/loose-ends'");
  const button = (label) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='${label}')`;
  await page.wait(`!!${button("attach to a stub")}`);
  await page.eval(`${button("attach to a stub")}.click()`);
  await page.wait("!!document.querySelector('#picker-candidate-0')");
  await page.key("Enter", { vk: 13, text: "\r" });
  await page.sleep(6000);
  console.log(
    `FOOTERS: ${await page.eval("JSON.stringify([...document.querySelectorAll('footer')].map(f=>f.innerText))")}`
  );
  await page.eval("location.hash='#/inbox'");
  await page.wait("document.body.innerText.includes('Does the cue work')");
  console.log(
    `INBOX: ${await page.eval("document.body.innerText.slice(0, 900)")}`
  );
  await page.sleep(500);
};
