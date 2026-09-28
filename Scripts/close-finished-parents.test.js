import { describe, expect, it } from "vitest";

import {
  closeFinishedParents,
  MAX_DEPTH,
  restApi,
} from "./close-finished-parents.mjs";

// An in-memory tracker speaking the walk's four calls. Tests assert what the
// tracker ends up holding — which issues are closed, why, with what comment —
// never the order the walk asked in.
function tracker(issues) {
  const byNumber = new Map(
    issues.map((i) => [
      i.number,
      { state: "open", state_reason: null, comments: [], ...i },
    ])
  );
  const get = (n) => byNumber.get(n);
  const hooks = {};
  return {
    get,
    hooks,
    api: {
      async parentOf(n) {
        const parent = get(n).parent;
        return parent === undefined ? null : { ...get(parent) };
      },
      async subIssuesOf(n) {
        const children = [...byNumber.values()].filter((i) => i.parent === n);
        hooks.afterListing?.(n);
        return children.map((c) => ({ ...c }));
      },
      async issue(n) {
        return { ...get(n) };
      },
      async close(n, comment) {
        const issue = get(n);
        issue.state = "closed";
        issue.state_reason = "completed";
        issue.comments.push(comment);
      },
    },
  };
}

// beat 170 → spec 327 → tickets 400…402, as beat 3 will be linked.
function beat(tickets) {
  return [
    { number: 170 },
    { number: 327, parent: 170 },
    ...tickets.map((t) => ({ parent: 327, ...t })),
  ];
}

const done = { state: "closed", state_reason: "completed" };

describe("closeFinishedParents", () => {
  it("closes the spec and then the beat in one call when the last ticket closes", async () => {
    const t = tracker(
      beat([
        { number: 400, ...done },
        { number: 401, ...done },
        { number: 402, ...done },
      ])
    );
    const closed = await closeFinishedParents(402, t.api);
    expect(closed.map((c) => c.number)).toEqual([327, 170]);
    expect(t.get(327)).toMatchObject({
      state: "closed",
      state_reason: "completed",
    });
    expect(t.get(170)).toMatchObject({
      state: "closed",
      state_reason: "completed",
    });
  });

  it("names the sub-issues that closed the parent in its comment", async () => {
    const t = tracker(
      beat([
        { number: 400, ...done },
        { number: 401, state: "closed", state_reason: "not_planned" },
      ])
    );
    await closeFinishedParents(400, t.api);
    expect(t.get(327).comments).toHaveLength(1);
    expect(t.get(327).comments[0]).toContain("#400");
    expect(t.get(327).comments[0]).toContain("#401 (not planned)");
    expect(t.get(170).comments[0]).toContain("#327");
  });

  it("leaves the spec open while any ticket is open", async () => {
    const t = tracker(beat([{ number: 400, ...done }, { number: 401 }]));
    expect(await closeFinishedParents(400, t.api)).toEqual([]);
    expect(t.get(327).state).toBe("open");
    expect(t.get(170).state).toBe("open");
  });

  it("leaves the spec open when no ticket closed as completed", async () => {
    // Every ticket scoped away is a decision for a person, not a completion.
    const t = tracker(
      beat([
        { number: 400, state: "closed", state_reason: "not_planned" },
        { number: 401, state: "closed", state_reason: "duplicate" },
      ])
    );
    expect(await closeFinishedParents(401, t.api)).toEqual([]);
    expect(t.get(327).state).toBe("open");
  });

  it("reads a closed sub-issue with no recorded reason as completed", async () => {
    // Issues closed before GitHub recorded a reason carry null, and GitHub
    // shows them as completed; the comment must not choke on one either.
    const t = tracker(
      beat([
        { number: 400, state: "closed", state_reason: null },
        { number: 401, ...done },
      ])
    );
    await closeFinishedParents(401, t.api);
    expect(t.get(327).state).toBe("closed");
    expect(t.get(327).comments[0]).toContain("#400, #401");
  });

  it("stops quietly at an issue with no parent", async () => {
    const t = tracker([{ number: 500, ...done }]);
    expect(await closeFinishedParents(500, t.api)).toEqual([]);
  });

  it("stops at a parent that is already closed and does not climb past it", async () => {
    const t = tracker(
      beat([{ number: 400, ...done }]).map((i) =>
        i.number === 327 ? { ...i, ...done } : i
      )
    );
    expect(await closeFinishedParents(400, t.api)).toEqual([]);
    expect(t.get(327).comments).toEqual([]);
    expect(t.get(170).state).toBe("open");
  });

  it("does not close a parent that another run closed after the listing", async () => {
    // Two tickets closing together: the other run wins the race.
    const t = tracker(beat([{ number: 400, ...done }]));
    t.hooks.afterListing = (n) => {
      if (n === 327)
        Object.assign(t.get(327), done, { comments: ["other run"] });
    };
    expect(await closeFinishedParents(400, t.api)).toEqual([]);
    expect(t.get(327).comments).toEqual(["other run"]);
  });

  it("climbs no higher than the depth cap", async () => {
    // A chain far deeper than any real tree, each issue the only child of the
    // next, all finished once the first closes.
    const top = MAX_DEPTH + 3;
    const t = tracker([
      { number: 1, parent: 2, ...done },
      ...Array.from({ length: top - 2 }, (_, i) => ({
        number: i + 2,
        parent: i + 3,
      })),
      { number: top },
    ]);
    const closed = await closeFinishedParents(1, t.api);
    expect(closed).toHaveLength(MAX_DEPTH);
    expect(t.get(top).state).toBe("open");
  });
});

// A fake of the one thing the adapter talks to: GitHub's REST API over fetch.
function github(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({
      method,
      path,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response("{}", { status: 404 });
    const { status = 200, body, link } = route;
    return new Response(JSON.stringify(body), {
      status,
      headers: link ? { link } : {},
    });
  };
  return { fetch, calls };
}

describe("restApi", () => {
  const base = "/repos/tacomancy/vitrine/issues";
  const api = (fake) =>
    restApi({ repository: "tacomancy/vitrine", token: "t", fetch: fake.fetch });

  it("reads a missing parent as none", async () => {
    const fake = github({});
    expect(await api(fake).parentOf(500)).toBeNull();
  });

  it("follows every page of sub-issues", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      state: "closed",
      state_reason: "completed",
    }));
    const fake = github({
      [`GET ${base}/327/sub_issues?per_page=100&page=1`]: {
        body: page1,
        link: `<https://api.github.com${base}/327/sub_issues?per_page=100&page=2>; rel="next"`,
      },
      [`GET ${base}/327/sub_issues?per_page=100&page=2`]: {
        body: [{ number: 101, state: "open", state_reason: null }],
      },
    });
    const children = await api(fake).subIssuesOf(327);
    expect(children).toHaveLength(101);
    expect(children.at(-1)).toMatchObject({ number: 101, state: "open" });
  });

  it("closes as completed and comments", async () => {
    const fake = github({
      [`POST ${base}/327/comments`]: { status: 201, body: {} },
      [`PATCH ${base}/327`]: { body: {} },
    });
    await api(fake).close(327, "every sub-issue is closed");
    expect(fake.calls).toContainEqual({
      method: "PATCH",
      path: `${base}/327`,
      body: { state: "closed", state_reason: "completed" },
    });
    expect(fake.calls).toContainEqual({
      method: "POST",
      path: `${base}/327/comments`,
      body: { body: "every sub-issue is closed" },
    });
  });

  it("refuses loudly on any other failure", async () => {
    const fake = github({ [`GET ${base}/327`]: { status: 500, body: {} } });
    await expect(api(fake).issue(327)).rejects.toThrow(/500/);
  });
});
