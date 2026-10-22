import { useMutation } from "@tanstack/react-query";
import type { Venue } from "core";
import { useState } from "react";
import {
  ActionRow,
  Button,
  FieldRow,
  FormSection,
  Input,
  Unlocks,
} from "./Form";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/**
 * An OpenAlex Scout's venue allowlist (ADR 0051 decision 9): the only venues
 * it asks, each added through a name search so nobody needs to know an
 * identifier. The search runs on a press or enter and never as the name is
 * typed (each costs 10 of a daily budget shared with others); a result shows
 * publisher, ISSN and works count to tell near-duplicates apart. A failed or
 * spent search is said in its own sentence and not as a search that found
 * nothing. It sits inside the Scout's form, so it handles enter itself.
 */
export function VenueAllowlist({
  venues,
  onChange,
}: {
  venues: Venue[];
  onChange: (venues: Venue[]) => void;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState("");
  const search = useMutation(trpc.scouts.searchNames.mutationOptions());
  const ready = name.trim() !== "";
  const found = search.data?.outcome === "found" ? search.data : null;

  function run() {
    if (!ready || search.isPending) return;
    search.mutate({ kind: "venue", name });
  }

  return (
    <FormSection title="Only these venues">
      {venues.length === 0 ? (
        <p className={styles.line}>
          Every journal and conference. Add a venue to ask only those.
        </p>
      ) : (
        <ul aria-label="Allowed venues">
          {venues.map((venue) => (
            <li key={venue.id}>
              {venue.name}{" "}
              <Button
                aria-label={`Remove ${venue.name}`}
                onClick={() =>
                  onChange(venues.filter((v) => v.id !== venue.id))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FieldRow
        label="Venue name"
        note="Searches OpenAlex when you press Search, not as you type; each search costs 10 of the day's shared budget."
      >
        {(field) => (
          <Input
            {...field}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Enter would save the whole Scout: here it means search.
              if (event.key !== "Enter") return;
              event.preventDefault();
              run();
            }}
          />
        )}
      </FieldRow>
      <ActionRow>
        <Button disabled={!ready || search.isPending} onClick={run}>
          Search venues
        </Button>
        {!ready && <Unlocks>Search needs a name.</Unlocks>}
      </ActionRow>
      {search.isError && (
        <p className={styles.line} role="alert">
          {search.error.message}
        </p>
      )}
      {search.data?.outcome === "failed" && (
        <p className={styles.line} role="alert">
          {search.data.sentence}
        </p>
      )}
      {found !== null &&
        (found.results.length === 0 ? (
          <p className={styles.line}>No venues found.</p>
        ) : (
          <ul aria-label="Venue results">
            {found.results.map((result) => {
              const chosen = venues.some((v) => v.id === result.id);
              return (
                <li key={result.id}>
                  {result.name} —{" "}
                  {[
                    result.publisher,
                    result.issn === null ? null : `ISSN ${result.issn}`,
                    `${result.worksCount.toLocaleString("en-US")} works`,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}{" "}
                  <Button
                    disabled={chosen}
                    aria-label={`Add ${result.name}${result.publisher === null ? "" : ` (${result.publisher})`}`}
                    onClick={() =>
                      onChange([
                        ...venues,
                        { id: result.id, name: result.name },
                      ])
                    }
                  >
                    {chosen ? "Added" : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ))}
      {found?.creditsLeft != null && (
        <p className={styles.line}>
          {found.creditsLeft.toLocaleString("en-US")} credits left today.
        </p>
      )}
    </FormSection>
  );
}
