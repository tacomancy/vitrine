import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Candidate, CandidateKind } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { KIND } from "./kinds";
import styles from "./Picker.module.css";
import { useTRPC } from "./trpc";

/**
 * The one picker (`docs/architecture.md` § Research Question view and
 * triage): a name-contains list over the index's files, narrowed to the
 * Kinds the caller asks for. Link opens it first (#211); attaching a source
 * and the `[[` of a why line open the same component. Entirely keyboard:
 * type to filter, the arrows move the choice, `↵` takes it, `esc` leaves.
 * Focus goes back to wherever it was when the picker opened — the picker
 * owns that, so no caller has to remember to restore it.
 */
export function Picker({
  label,
  kinds,
  exclude,
  onChoose,
  onClose,
}: {
  /** What the picker is for — the dialog's and the list's accessible name. */
  label: string;
  /** The Kinds to narrow to; every Markdown file when omitted. */
  kinds?: CandidateKind[];
  /** Vault-relative paths to leave out: what the caller is standing on. */
  exclude?: string[];
  onChoose: (candidate: Candidate) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const [arrowedTo, setArrowedTo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Where focus was when the picker opened, put back when it closes —
  // however it closes, including a choice that unmounts it.
  useEffect(() => {
    const restoreTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => restoreTo?.focus();
  }, []);

  // The old rows stay while the new ones are asked for, rather than the
  // list flashing empty between keystrokes.
  const listing = useQuery({
    ...trpc.picker.candidates.queryOptions({
      query,
      ...(kinds === undefined ? {} : { kinds }),
      ...(exclude === undefined ? {} : { exclude }),
    }),
    placeholderData: keepPreviousData,
  });
  const rows = listing.data?.rows ?? [];
  const total = listing.data?.total ?? 0;
  // The choice never points past the list a new query returned.
  const chosen = Math.min(arrowedTo, Math.max(rows.length - 1, 0));

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        return;
      case "Enter": {
        event.preventDefault();
        const row = rows[chosen];
        if (row !== undefined) onChoose(row);
        return;
      }
      case "ArrowDown":
        event.preventDefault();
        setArrowedTo(Math.min(chosen + 1, rows.length - 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setArrowedTo(Math.max(chosen - 1, 0));
        return;
      default:
        return;
    }
  }

  return (
    <div className={styles.picker} role="dialog" aria-label={label}>
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="combobox"
          aria-label="Find"
          aria-expanded
          aria-controls="picker-list"
          aria-activedescendant={rows[chosen] ? candidateId(chosen) : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setArrowedTo(0);
          }}
          onKeyDown={onKeyDown}
        />
        <span className={styles.hint}>↵ choose · esc leaves</span>
      </div>
      {/* A read that failed must never read as an empty vault. */}
      {listing.isError && (
        <p className={styles.message} role="alert">
          {listing.error.message}
        </p>
      )}
      <ul
        id="picker-list"
        className={styles.list}
        role="listbox"
        aria-label={label}
      >
        {rows.map((candidate, index) => (
          <li
            key={candidate.path}
            id={candidateId(index)}
            role="option"
            aria-selected={index === chosen}
            className={styles.candidate}
            onClick={() => onChoose(candidate)}
          >
            <KindGlyph kind={candidate.kind} />
            <span className={styles.name}>{candidate.name}</span>
            {/* A paper's title beside its citekey: `rasch2013` is the name
                the vault files it under, not one anyone recognises it by.
                Shown only — what matched is still the name. */}
            <span className={styles.title}>{candidate.title ?? ""}</span>
            {candidate.pdf !== undefined && (
              <span className={styles.pdf}>
                {candidate.pdf ? "pdf" : "no pdf"}
              </span>
            )}
          </li>
        ))}
      </ul>
      {!listing.isError && rows.length === 0 && (
        <p className={styles.message}>
          Nothing in the vault matches that name.
        </p>
      )}
      {/* Never a silent cut: a list longer than one ask says how long. */}
      {total > rows.length && (
        <p className={styles.message}>
          {rows.length} of {total} — keep typing
        </p>
      )}
    </div>
  );
}

const candidateId = (index: number) => `picker-candidate-${index}`;

/** A file's Kind as its glyph, with the Kind as the accessible name. */
function KindGlyph({ kind }: { kind: CandidateKind }) {
  const { glyph, label } = KIND[kind] ?? { glyph: "◇", label: kind };
  return (
    <span className={styles.glyph} role="img" aria-label={label} title={label}>
      {glyph}
    </span>
  );
}
