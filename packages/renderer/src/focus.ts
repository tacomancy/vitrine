import { useState } from "react";

/**
 * Where the keyboard was when an overlay opened, and the `leave` that puts
 * it back and then closes. The overlay calls `leave` on every path out, so
 * no caller has to remember where the page's keyboard was.
 *
 * Read during the first render rather than in an effect: effects run
 * child-first, so the overlay's own input (or a Picker inside it) would
 * already have taken the keyboard by the time an effect here looked, and
 * this would remember the overlay instead of the page.
 *
 * The keyboard goes back *before* `onClose`, never after. What the caller
 * does on close is where a landing may take the keyboard (ADR 0010); put
 * back afterwards, the old focus would overwrite it.
 *
 * Only for overlays that close through a callback. The Picker, the Global
 * command and the Why line put focus back in their unmount cleanup instead,
 * because a parent can unmount them without calling `onClose` — and the
 * Why line's caret handling relies on its nested Picker doing exactly that.
 * The Capture line stays mounted and reads again on every open.
 */
export function useRestoreFocus(onClose: () => void): () => void {
  const [restoreTo] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  return () => {
    restoreTo?.focus();
    onClose();
  };
}
