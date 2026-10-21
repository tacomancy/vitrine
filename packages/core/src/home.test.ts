import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";

// Home's dateline (spec #728, stories 9–10): *away since the 14th* is said only
// after a gap, against the previous open day, so a normal day reads as no
// absence at all.

afterEach(closeCores);

function clock(start: string) {
  let at = new Date(start);
  return {
    now: () => at,
    set: (iso: string) => {
      at = new Date(iso);
    },
  };
}

async function awayAfter(opens: string[], today: string) {
  const vault = await vaultWith({ "a.md": "# a\n" });
  const time = clock(opens[0] ?? today);
  const c = await core({ now: time.now });
  await c.mutate("vault.open", { path: vault });
  await c.indexed();
  for (const day of opens.slice(1)) {
    time.set(day);
    await c.focused();
  }
  time.set(today);
  await c.focused();
  const reply = await c.query<{ since: string | null }>("home.away");
  return reply.result?.data;
}

describe("home.away", () => {
  it("names the previous open day after a gap of more than a day", async () => {
    expect(
      await awayAfter(
        ["2026-09-14T10:00:00+01:00"],
        "2026-09-21T10:00:00+01:00"
      )
    ).toEqual({ since: "2026-09-14" });
  });

  it("says nothing when the vault was open yesterday", async () => {
    expect(
      await awayAfter(
        ["2026-09-20T10:00:00+01:00"],
        "2026-09-21T10:00:00+01:00"
      )
    ).toEqual({ since: null });
  });

  it("says nothing on the first ever open, when there is no previous day", async () => {
    expect(await awayAfter([], "2026-09-21T10:00:00+01:00")).toEqual({
      since: null,
    });
  });

  it("measures against the latest previous day, not the first", async () => {
    expect(
      await awayAfter(
        ["2026-09-01T10:00:00+01:00", "2026-09-17T10:00:00+01:00"],
        "2026-09-21T10:00:00+01:00"
      )
    ).toEqual({ since: "2026-09-17" });
  });
});
