import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "./Form";
import { useChosenInView } from "./chosen";
import { useTRPC } from "./trpc";

type Node = { canonical: string; display: string; children: Node[] };
type Row = { canonical: string; display: string; depth: number };

/** The vault's Tag tree as one list in tree order, each row at its depth. */
function flatten(nodes: Node[], depth = 0): Row[] {
  return nodes.flatMap((n) => [
    { canonical: n.canonical, display: n.display, depth },
    ...flatten(n.children, depth + 1),
  ]);
}

const ROW_ID = "scout-tag-";

/**
 * A Scout's Filter as Tags (spec #678): a keyboard list over the vault's Tag
 * tree, the chosen Tags as chips each expandable to its Terms in use, and the
 * arXiv query they compile to, verbatim. The Tag is kept as the index keys it
 * (the Lexicon's key), shown as written. Terms and query come from the core's
 * `previewTags`, which reads the same Lexicon a run does, so the form cannot
 * show what a run will not ask.
 */
export function TagsFilter({
  chosen,
  onChange,
}: {
  chosen: string[];
  onChange: (tags: string[]) => void;
}) {
  const trpc = useTRPC();
  const tree = useQuery(trpc.vault.tags.queryOptions());
  const preview = useQuery({
    ...trpc.scouts.previewTags.queryOptions({ tags: chosen }),
    enabled: chosen.length > 0,
  });
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<string[]>([]);
  const rows = flatten(tree.data?.tags ?? []);
  const row = rows[Math.min(at, rows.length - 1)];
  const activeId = row === undefined ? undefined : `${ROW_ID}${at}`;
  useChosenInView(activeId);

  const toggle = (canonical: string) =>
    onChange(
      chosen.includes(canonical)
        ? chosen.filter((t) => t !== canonical)
        : [...chosen, canonical]
    );

  function onKeyDown(event: React.KeyboardEvent) {
    if (rows.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setAt(Math.min(at + 1, rows.length - 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setAt(Math.max(at - 1, 0));
        return;
      case "Enter":
      case " ":
        // Not a submit of the form around it.
        event.preventDefault();
        if (row !== undefined) toggle(row.canonical);
        return;
      default:
        return;
    }
  }

  const termsOf = (tag: string) =>
    preview.data?.tags.find((t) => t.tag === tag)?.terms;

  return (
    <div>
      {tree.isError && <p role="alert">{tree.error.message}</p>}
      {tree.data !== undefined && rows.length === 0 && (
        <p>No Tags in the vault yet.</p>
      )}
      <ul
        role="listbox"
        aria-label="Tags in the vault"
        aria-multiselectable="true"
        tabIndex={0}
        aria-activedescendant={activeId}
        onKeyDown={onKeyDown}
      >
        {rows.map((r, i) => (
          <li
            key={r.canonical}
            id={`${ROW_ID}${i}`}
            role="option"
            aria-selected={chosen.includes(r.canonical)}
            style={{ paddingLeft: `${r.depth}rem` }}
            onClick={() => {
              setAt(i);
              toggle(r.canonical);
            }}
          >
            {chosen.includes(r.canonical) ? "✓ " : ""}
            {r.display}
          </li>
        ))}
      </ul>
      {chosen.length > 0 && (
        <ul aria-label="Chosen Tags">
          {chosen.map((tag) => {
            const terms = termsOf(tag);
            const expanded = open.includes(tag);
            return (
              <li key={tag}>
                <Button
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen(
                      expanded ? open.filter((t) => t !== tag) : [...open, tag]
                    )
                  }
                >
                  {tag} — Terms
                </Button>{" "}
                <Button
                  aria-label={`Remove ${tag}`}
                  onClick={() => toggle(tag)}
                >
                  ×
                </Button>
                {terms?.length === 0 && (
                  <small>
                    {" "}
                    no Terms to search: seed one in its Lexicon, or use a Query.
                  </small>
                )}
                {expanded && terms !== undefined && terms.length > 0 && (
                  <ul aria-label={`Terms of ${tag}`}>
                    {terms.map((term) => (
                      <li key={term}>{term}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {preview.isError && <p role="alert">{preview.error.message}</p>}
      {preview.data?.query != null && (
        <p>
          Compiled query:{" "}
          <code aria-label="Compiled query">{preview.data.query}</code>
        </p>
      )}
      <small>
        A Lexicon change does not search back: it changes what the next run
        asks, and the window stays where it was.
      </small>
    </div>
  );
}
