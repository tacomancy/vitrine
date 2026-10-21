import type { KeyboardEvent } from "react";

// The keys every list of the pane answers to (ADR 0030): the choice moves,
// ↵ opens it.
export function listKeys(
  at: number,
  count: number,
  choose: (to: number) => void,
  open: (index: number) => void
) {
  return (event: KeyboardEvent<HTMLUListElement>) => {
    const move = (to: number) => choose(Math.min(Math.max(to, 0), count - 1));
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(count - 1);
        break;
      case "Enter":
        open(at);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}
