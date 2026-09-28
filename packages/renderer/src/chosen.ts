import { useEffect } from "react";

/**
 * Keep the row a keyboard list's choice is on inside the window the list
 * shows (ADR 0030, #320).
 *
 * Every list in the app that scrolls is longer than its window: the Global
 * command and the Picker cap at fifty rows in room for nine, and the Inbox
 * holds every Question in the vault. A choice walked past the fold would
 * otherwise leave the list sitting still behind it, so `↵` — and the Inbox's
 * `p`, `a`, `d`, `r` and `l` — would act on a row nobody can see. That is the
 * no-silent-failures invariant, not a matter of polish.
 *
 * The argument is the element id the list already hands to
 * `aria-activedescendant`, which is the same statement in the accessibility
 * tree: *this is the row the keyboard is on*. Taking that, rather than an
 * index or a line in each key handler, is what makes this hard to get wrong.
 * The Inbox's selection also moves on a click, on a capture landing, on an
 * arrival at a Question's Address and on a rename the watcher reports, and no
 * caller can move it without moving the id. It is looked up the way the
 * browser resolves the attribute itself, so the hook and the accessibility
 * tree cannot come to disagree about which element they mean.
 *
 * `block: "nearest"` is the least scroll that makes the row visible, and none
 * at all when it already is — so the rows just read stay where they were, and
 * opening a list never jolts.
 */
export function useChosenInView(rowId: string | undefined): void {
  useEffect(() => {
    if (rowId === undefined) return;
    document.getElementById(rowId)?.scrollIntoView({ block: "nearest" });
  }, [rowId]);
}
