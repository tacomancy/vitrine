#!/usr/bin/env node
// Closes a parent issue once its last sub-issue closes, and keeps climbing:
// ticket → spec → beat (#329). GitHub shows sub-issues but never acts on
// them, so without this a finished spec and its beat sit open until someone
// notices.
//
// Usage: GH_TOKEN=… GITHUB_REPOSITORY=owner/repo \
//        node Scripts/close-finished-parents.mjs <issue-number>
// .github/workflows/close-finished-parents.yml runs it on every issue close.
import { pathToFileURL } from "node:url";

/**
 * Walk up from `start`, closing each parent whose sub-issues are all closed.
 *
 * The walk climbs in one call rather than leaving the next level to the next
 * workflow run, because a close made with the workflow's own token starts no
 * workflow run at all — the beat would never hear that its spec closed.
 *
 * A parent is finished only when every sub-issue is closed *and* at least one
 * closed as completed. Tickets all closed as not planned or duplicate mean the
 * work was scoped away, which is a person's call to make about the spec, not
 * a completion to record for them.
 */
export async function closeFinishedParents(start, api) {
  const closed = [];
  let child = start;
  while (closed.length < MAX_DEPTH) {
    const parent = await api.parentOf(child);
    if (parent === null) break;
    const children = await api.subIssuesOf(parent.number);
    if (children.some((c) => c.state !== "closed")) break;
    if (!children.some(completed)) break;
    // Read the parent's state as late as possible. A parent already closed was
    // settled by whoever closed it — a person, or the other run when two
    // tickets close together — and climbing past it would second-guess that.
    if ((await api.issue(parent.number)).state === "closed") break;
    await api.close(parent.number, comment(children, start));
    closed.push({
      number: parent.number,
      closedBy: children.map((c) => c.number),
    });
    child = parent.number;
  }
  return closed;
}

/**
 * The tree this walks is three deep — ticket, spec, beat. The cap exists only
 * so that a walk gone wrong stops rather than closing issues without end.
 */
export const MAX_DEPTH = 10;

// An issue closed before GitHub recorded a reason carries `state_reason:
// null`, and GitHub shows it as completed; so does this.
function completed(issue) {
  return issue.state_reason === "completed" || issue.state_reason === null;
}

function comment(children, start) {
  const list = children
    .map((c) =>
      completed(c)
        ? `#${c.number}`
        : `#${c.number} (${c.state_reason.replaceAll("_", " ")})`
    )
    .join(", ");
  return `Every sub-issue is closed — ${list} — so this closes too. Closed automatically when #${start} closed (\`Scripts/close-finished-parents.mjs\`, #329).`;
}

/** The walk's four calls against GitHub's REST API. */
export function restApi({ repository, token, fetch = globalThis.fetch }) {
  const root = `https://api.github.com/repos/${repository}/issues`;
  const request = (url, init = {}) =>
    fetch(url, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  const failed = (url, init, response) =>
    new Error(`${init?.method ?? "GET"} ${url} answered ${response.status}`);
  // Every call but `parentOf` has no answer it expects to fail with.
  const readOk = async (url, init) => {
    const response = await request(url, init);
    if (!response.ok) throw failed(url, init, response);
    return { body: await response.json(), link: response.headers.get("link") };
  };
  return {
    async parentOf(n) {
      const url = `${root}/${n}/parent`;
      const response = await request(url);
      // GitHub answers 404 for an issue that has no parent.
      if (response.status === 404) return null;
      if (!response.ok) throw failed(url, {}, response);
      return response.json();
    },
    async subIssuesOf(n) {
      const all = [];
      let url = `${root}/${n}/sub_issues?per_page=100&page=1`;
      while (url) {
        const { body, link } = await readOk(url);
        all.push(...body);
        url = /<([^>]+)>;\s*rel="next"/.exec(link ?? "")?.[1] ?? null;
      }
      return all;
    },
    async issue(n) {
      return (await readOk(`${root}/${n}`)).body;
    },
    async close(n, body) {
      // Comment first: if the close then fails, the issue says why it was
      // about to close rather than closing with no word.
      await readOk(`${root}/${n}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      await readOk(`${root}/${n}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const start = Number(process.argv[2]);
  const { GH_TOKEN: token, GITHUB_REPOSITORY: repository } = process.env;
  if (!Number.isInteger(start) || !token || !repository) {
    console.error(
      "usage: GH_TOKEN=… GITHUB_REPOSITORY=owner/repo close-finished-parents.mjs <issue-number>"
    );
    process.exit(2);
  }
  const closed = await closeFinishedParents(
    start,
    restApi({ repository, token })
  );
  console.log(
    closed.length === 0
      ? `#${start}: no parent finished`
      : closed
          .map(
            (c) =>
              `closed #${c.number} (sub-issues ${c.closedBy.map((n) => `#${n}`).join(", ")})`
          )
          .join("\n")
  );
}
