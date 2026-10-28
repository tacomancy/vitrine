import { readFileSync } from "node:fs";

/**
 * A CSS module as a test can see it. jsdom applies no stylesheet, so a rule
 * that gives a `Button` back what its surface needs (#917, #919) is checked
 * in two halves: what the module's source declares under a selector, and
 * whether that selector, with the module's hashed class names put in, matches
 * the element the component drew. The second half is what catches a rule
 * whose selector no longer reaches its button after the markup moves.
 */
export function moduleRules(file: string, styles: Record<string, string>) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // No module these tests read holds an at-rule, so every block is flat. An
  // `@media` added to one nests a block, which this misreads: a rule inside
  // it would be missed and `declarations` would throw for it.
  const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
    ([, selectors, body]) => ({
      selectors: selectors!
        .split(",")
        .map((s) => s.trim().replace(/\s+/g, " ")),
      body: body!,
    })
  );
  return {
    /** Every declaration written under `selector`, across the blocks naming it. */
    declarations(selector: string): string {
      const found = blocks.filter((b) => b.selectors.includes(selector));
      if (found.length === 0) throw new Error(`no rule for ${selector}`);
      return found.map((b) => b.body).join("");
    },
    /** Whether `selector` matches `element`, its state pseudo-classes aside. */
    reaches(element: Element, selector: string): boolean {
      const real = selector
        .replace(/::?(after|before|hover|focus-visible)\b/g, "")
        .replace(/\.([A-Za-z][\w-]*)/g, (_, name: string) => {
          const hashed = styles[name];
          if (hashed === undefined) throw new Error(`no class .${name}`);
          return `.${hashed}`;
        });
      return element.matches(real);
    },
  };
}
