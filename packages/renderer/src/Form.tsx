import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./Form.module.css";

/**
 * The shared pieces of a form (`docs/architecture.md` § UI conventions): a
 * surface composes these instead of styling its own controls, so a form cannot
 * drift by hand. Everything here is a plain element underneath — native
 * inputs, selects and buttons — so keyboard and screen-reader behaviour is the
 * platform's.
 */

/** A titled group of rows. Always open: nothing that governs a thing is hidden. */
export function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    // The seam is on the wrapper: a fieldset draws its own top border
    // through its legend.
    <div className={styles.seam}>
      <fieldset className={styles.section}>
        <legend className={styles.heading}>{title}</legend>
        {children}
      </fieldset>
    </div>
  );
}

/** What a row hands its control so the label and the note are tied to it. */
export type FieldProps = { id: string; "aria-describedby": string | undefined };

/**
 * One field: a narrow label column, the control beside it at its own width,
 * a muted note beneath. The control is a function of the ids to tie, so the
 * label names it and the note describes it without the caller wiring either.
 */
export function FieldRow({
  label,
  note,
  children,
}: {
  label: string;
  note?: ReactNode;
  children: (props: FieldProps) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        {children({
          id,
          "aria-describedby": note === undefined ? undefined : noteId,
        })}
        {note !== undefined && (
          <small id={noteId} className={styles.note}>
            {note}
          </small>
        )}
      </div>
    </div>
  );
}

/** A row for a one-of-N or many-of-N choice, named as a group rather than tied to one control. */
export function GroupRow({
  label,
  note,
  children,
}: {
  label: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div
      role="group"
      aria-labelledby={id}
      aria-describedby={note === undefined ? undefined : noteId}
      className={styles.row}
    >
      <span id={id} className={styles.label}>
        {label}
      </span>
      <div className={styles.control}>
        {children}
        {note !== undefined && (
          <small id={noteId} className={styles.note}>
            {note}
          </small>
        )}
      </div>
    </div>
  );
}

/** A row with no label: the actions that follow a section's fields, and what they said. */
export function ActionRow({ children }: { children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span />
      <div className={styles.actions}>{children}</div>
    </div>
  );
}

type ButtonProps = Omit<
  React.ComponentProps<"button">,
  "className" | "type"
> & {
  /** One primary per form (filled sapphire); everything else is sapphire text. */
  tier?: "primary" | "secondary";
};

export function Button({ tier = "secondary", ...rest }: ButtonProps) {
  return (
    <button
      // A button inside a form submits it; only the primary is meant to.
      type={tier === "primary" ? "submit" : "button"}
      className={tier === "primary" ? styles.primary : styles.secondary}
      {...rest}
    />
  );
}

/** What a disabled control is waiting for, said beside it. */
export function Unlocks({ children }: { children: ReactNode }) {
  return <span className={styles.unlocks}>{children}</span>;
}

export function Input({
  wide,
  ...rest
}: Omit<React.ComponentProps<"input">, "className"> & {
  /** For a sentence rather than a word: as wide as a TextArea. */
  wide?: boolean;
}) {
  return (
    <input
      className={wide ? `${styles.input} ${styles.wide}` : styles.input}
      {...rest}
    />
  );
}

export function TextArea(
  props: Omit<React.ComponentProps<"textarea">, "className">
) {
  return <textarea className={styles.input} {...props} />;
}

/** The native select, restyled; the chevron is drawn by the wrapper. */
export function Select(
  props: Omit<React.ComponentProps<"select">, "className">
) {
  return (
    <span className={styles.selectWrap}>
      <select className={styles.input} {...props} />
    </span>
  );
}

type Segment<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  options: readonly Segment<T>[];
  /** Null when nothing is chosen yet: a choice with no default. */
  value: T | null;
  onChange: (value: T) => void;
  /** Focus the segment that holds the tab stop as the control mounts. */
  autoFocus?: boolean;
} & (
  | { label: string; labelledBy?: undefined }
  | { labelledBy: string; label?: undefined }
);

/**
 * Every one-of-N choice: real radios underneath, drawn as touching segments.
 * The arrow keys move and select (wrapping), Tab leaves the group from the
 * chosen segment, and the group is announced with its name. The arrows are
 * handled here, not left to the browser, so the behaviour is the same wherever
 * it runs.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  autoFocus,
  label,
  labelledBy,
}: SegmentedProps<T>) {
  const name = useId();
  const radios = useRef<(HTMLInputElement | null)[]>([]);
  const chosen = options.findIndex((o) => o.value === value);
  // An effect, not the autoFocus attribute: a form that opens as another
  // one closes would have its focus handed back to the page by that one.
  useEffect(() => {
    if (autoFocus) radios.current[Math.max(chosen, 0)]?.focus();
    // Only as the control mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: KeyboardEvent, index: number) {
    // Alt/Cmd+arrow are the browser's (back, forward), not ours.
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    radios.current[next]?.focus();
  }

  return (
    <span
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={styles.segments}
    >
      {options.map((option, index) => (
        <label key={option.value} className={styles.segment}>
          <input
            ref={(el) => {
              radios.current[index] = el;
            }}
            type="radio"
            value={option.value}
            name={name}
            className={styles.segmentRadio}
            checked={value === option.value}
            // One Tab stop: the chosen segment, or the first when none is.
            tabIndex={(chosen === -1 ? index === 0 : index === chosen) ? 0 : -1}
            onChange={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </span>
  );
}

/** A labelled row holding a segmented control, the label tying to the group. */
export function SegmentedRow<T extends string>({
  label,
  note,
  ...control
}: { label: string; note?: ReactNode } & Omit<
  SegmentedProps<T>,
  "label" | "labelledBy"
>) {
  const id = useId();
  return (
    <div className={styles.row}>
      <span id={id} className={styles.label}>
        {label}
      </span>
      <div className={styles.control}>
        <SegmentedControl {...control} labelledBy={id} />
        {note !== undefined && <small className={styles.note}>{note}</small>}
      </div>
    </div>
  );
}
