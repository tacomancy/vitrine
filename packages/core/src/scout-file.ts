import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, parseDocument, YAMLParseError } from "yaml";
import { VaultError } from "./errors.js";

/**
 * A Scout as its file says it (ADR 0016 decision 4; `docs/architecture.md`
 * § Vault layout, `scouts/<id>.yaml`). Read as found, ADR 0009's rule: a
 * hand edit is honoured on the next read, and a file that does not parse is
 * returned by name rather than skipped (ADR 0039 decision 7). Runtime never
 * lives in the file; everything a run learns is a row in `queue.sqlite`.
 */
export type Scout = {
  /** The file's own name, `.vitrine/scouts/<id>.yaml`: what a run row refers to. */
  id: string;
  name: string;
  /** What it watches: arXiv through its API, or one web page (ADR 0017). */
  source: { kind: "arxiv" } | { kind: "watched"; url: string };
  /** The arXiv Query; for a Watched source, the address — what a run asked, so an edit to it overrides a wait. */
  query: string;
  cadence: "daily" | "weekly" | "monthly";
  /** Question ids (§ Vault layout: `assigned: [question ids]`). */
  assigned: string[];
  /** Where a Proposal lands on arrival; stamped then, so editing it moves nothing already here. */
  lane: "review" | "skim";
  paused: boolean;
  /** Where the first run's window opens, unless `searchBackTo` reaches further. */
  created: Date;
  /** *Also search back to* (ADR 0016 decision 5): the first run opens its window here and its finds are Retroactive. */
  searchBackTo: Date | null;
};

/** A Scout file that does not parse: its name, and one sentence naming what is wrong. */
export type UnreadableScout = { file: string; sentence: string };

export const SCOUTS_FOLDER = ".vitrine/scouts";

const CADENCES = ["daily", "weekly", "monthly"] as const;
const LANES = ["review", "skim"] as const;

export async function readScouts(
  vaultPath: string
): Promise<{ scouts: Scout[]; unreadable: UnreadableScout[] }> {
  const folder = join(vaultPath, SCOUTS_FOLDER);
  const names = await readdir(folder).catch(() => [] as string[]);
  const scouts: Scout[] = [];
  const unreadable: UnreadableScout[] = [];
  for (const file of names.filter((n) => /\.ya?ml$/i.test(n)).sort()) {
    const read = readScout(
      file.replace(/\.ya?ml$/i, ""),
      await readFile(join(folder, file), "utf8")
    );
    if (read.ok) scouts.push(read.scout);
    else
      unreadable.push({
        file,
        sentence: `This file could not be read: ${read.problem}.`,
      });
  }
  return { scouts, unreadable };
}

/**
 * *Pause* from Loose Ends (#453): the one edit the app makes to a Scout file,
 * a key set in place. The document is edited rather than re-stringified so a
 * hand-written file keeps its comments and order (ADR 0009). A file that does
 * not parse is refused, not rewritten: the app would be guessing at its shape.
 */
export async function pauseScout(
  vaultPath: string,
  scoutId: string
): Promise<void> {
  const { scouts } = await readScouts(vaultPath);
  if (!scouts.some((s) => s.id === scoutId)) {
    throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
  }
  const folder = join(vaultPath, SCOUTS_FOLDER);
  const file = (await readdir(folder)).find(
    (n) => /\.ya?ml$/i.test(n) && n.replace(/\.ya?ml$/i, "") === scoutId
  );
  // Gone between the read above and this one: refused, not a raw TypeError.
  if (file === undefined) {
    throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
  }
  const doc = parseDocument(await readFile(join(folder, file), "utf8"));
  doc.set("paused", true);
  await writeFile(join(folder, file), doc.toString());
}

type Read = { ok: true; scout: Scout } | { ok: false; problem: string };

function readScout(id: string, text: string): Read {
  let doc: unknown;
  try {
    // `yaml`'s default schema leaves a timestamp as the string it was typed.
    doc = parse(text);
  } catch (cause) {
    const line =
      cause instanceof YAMLParseError ? cause.linePos?.[0].line : undefined;
    return {
      ok: false,
      problem:
        line === undefined
          ? "it is not valid YAML"
          : `line ${line} is not valid YAML`,
    };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, problem: "it is not a map of keys" };
  }
  const file = doc as Record<string, unknown>;
  const declared = file["source"] as Record<string, unknown> | undefined;
  const kind = declared?.["kind"] ?? "arxiv";
  let source: Scout["source"];
  let query: string;
  if (kind === "watched") {
    const url = declared?.["url"];
    if (typeof url !== "string" || !/^https?:\/\/\S+$/i.test(url.trim())) {
      return { ok: false, problem: "source.url is not a web address" };
    }
    query = url.trim();
    source = { kind: "watched", url: query };
  } else if (kind === "arxiv") {
    const filter = file["filter"] as Record<string, unknown> | undefined;
    const asked = filter?.["query"];
    if (typeof asked !== "string" || asked.trim() === "") {
      return { ok: false, problem: "it has no filter.query" };
    }
    query = asked;
    source = { kind: "arxiv" };
  } else {
    return { ok: false, problem: "source.kind is not arxiv or watched" };
  }
  const cadence = file["cadence"];
  if (!CADENCES.includes(cadence as never)) {
    return { ok: false, problem: "cadence is not daily, weekly or monthly" };
  }
  const lane = file["lane"] ?? "review";
  if (!LANES.includes(lane as never)) {
    return { ok: false, problem: "lane is not review or skim" };
  }
  const assigned = file["assigned"] ?? [];
  if (
    !Array.isArray(assigned) ||
    !assigned.every((q) => typeof q === "string")
  ) {
    return { ok: false, problem: "assigned is not a list of Question ids" };
  }
  const created = date(file["created"]);
  if (created === null) return { ok: false, problem: "created is not a date" };
  const back = file["search_back_to"];
  const searchBackTo = back === undefined ? null : date(back);
  if (back !== undefined && searchBackTo === null) {
    return { ok: false, problem: "search_back_to is not a date" };
  }
  return {
    ok: true,
    scout: {
      id,
      name:
        typeof file["name"] === "string" && file["name"] !== ""
          ? file["name"]
          : id,
      source,
      query: query.trim(),
      cadence: cadence as Scout["cadence"],
      assigned,
      lane: lane as Scout["lane"],
      paused: file["paused"] === true,
      created,
      searchBackTo,
    },
  };
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
