// Shared by the drives: what a researcher does on the Question Map, as page
// scripts (docs/agents/run.md).
export { press } from "../scout-demo/helpers.mjs";

export const button = (label) =>
  `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;

/**
 * The three theme states of tokens.css: the OS preference (dark or light, by
 * emulation) and `[data-theme]` forcing one against it. QM_THEME is
 * `dark`, `light`, `forced-dark` (data-theme=dark under a light OS) or
 * `forced-light`.
 */
export async function applyTheme(page, theme = process.env.QM_THEME) {
  if (theme === undefined) return;
  const forced = theme.startsWith("forced-");
  const scheme = forced ? (theme === "forced-dark" ? "light" : "dark") : theme;
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }],
  });
  await page.eval(
    forced
      ? `document.documentElement.dataset.theme=${JSON.stringify(theme.slice(7))}`
      : "delete document.documentElement.dataset.theme"
  );
}

export async function openMap(page) {
  await page.eval("location.hash='#/question-map'");
  await page.wait("!!document.querySelector('#question-map-title')");
}

export async function openMapRead(page) {
  await openMap(page);
  await page.wait("!!document.querySelector('[role=grid]')", 20000);
}

export const stated = (page) =>
  page.eval("document.querySelector('[data-slot=matrix] p')?.innerText");

export const gridSize = (page) =>
  page.eval(`(() => {
    const g=document.querySelector('[role=grid]');
    return g ? { rows: g.querySelectorAll('[role=rowheader]').length, columns: g.querySelectorAll('[role=columnheader]').length } : null;
  })()`);

export const readingButtons = (page) =>
  page.eval(
    "[...document.querySelectorAll('[data-slot=readings] section > button')].map(b=>b.textContent.trim())"
  );

export const expect = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

/** The styles a theme resolves to, quoted in the PR (docs/agents/run.md § 3). */
export const tokens = (page) =>
  page.eval(`(() => {
    const css=getComputedStyle(document.documentElement);
    const cell=document.querySelector('[role=gridcell][aria-label]:not([aria-label$=": 0 items"])');
    return {
      seq1: css.getPropertyValue('--color-seq-1').trim(),
      seq5: css.getPropertyValue('--color-seq-5').trim(),
      page: getComputedStyle(document.body).backgroundColor,
      cell: cell && getComputedStyle(cell).backgroundColor,
    };
  })()`);
