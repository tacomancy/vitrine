import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRestoreFocus } from "./focus";

afterEach(cleanup);

/**
 * An overlay as the app's are built: a child's mount effect takes the
 * keyboard — as the Picker inside the attach form does — and its one way
 * out is `leave`.
 */
function Overlay({ onClose }: { onClose: () => void }) {
  const leave = useRestoreFocus(onClose);
  return <Input onEscape={leave} />;
}

function Input({ onEscape }: { onEscape: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <input
      aria-label="overlay"
      ref={input}
      onKeyDown={(event) => event.key === "Escape" && onEscape()}
    />
  );
}

/** A page with somewhere for the keyboard to be, and somewhere to land. */
function Page({
  open,
  onClose,
}: {
  open: boolean;
  onClose: (landing: HTMLElement) => void;
}) {
  const landing = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button>where it was</button>
      <button ref={landing}>landing</button>
      {open && <Overlay onClose={() => onClose(landing.current!)} />}
    </>
  );
}

describe("useRestoreFocus", () => {
  it("puts the keyboard back where it was before a child's mount effect took it", () => {
    const { rerender } = render(<Page open={false} onClose={() => {}} />);
    const where = screen.getByRole("button", { name: "where it was" });
    where.focus();
    rerender(<Page open onClose={() => {}} />);
    const overlay = screen.getByRole("textbox", { name: "overlay" });
    expect(document.activeElement).toBe(overlay);

    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(document.activeElement).toBe(where);
  });

  it("closes after putting the keyboard back, so a close that lands elsewhere keeps it", () => {
    const onClose = vi.fn((landing: HTMLElement) => landing.focus());
    const { rerender } = render(<Page open={false} onClose={onClose} />);
    screen.getByRole("button", { name: "where it was" }).focus();
    rerender(<Page open onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "overlay" }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "landing" })
    );
  });

  it("still closes when what had the keyboard was no HTML element", () => {
    const onClose = vi.fn();
    render(<svg tabIndex={0} aria-label="figure" />);
    const figure = screen.getByLabelText("figure");
    (figure as unknown as HTMLOrSVGElement).focus();
    expect(document.activeElement).toBe(figure);

    render(<Overlay onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "overlay" }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
