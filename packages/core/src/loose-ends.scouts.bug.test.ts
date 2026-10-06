import { afterEach, expect, it, vi } from "vitest";
import { closeCores, core, tmp } from "./test-core.js";

// What Loose Ends does with a Scouts folder it cannot list is a *could not
// judge* line (`scout-file.test.ts`), because the vault said so: its own
// refusal is the only thing worded as a fault in the vault (#526). Anything
// else out of the reader is a bug, and a bug is not a line in a footer — it
// fails the read, where someone sees it.

vi.mock("./scout-file.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scout-file.js")>()),
  readScouts: () => Promise.reject(new TypeError("a bug in the reader")),
}));

afterEach(closeCores);

it("fails the dashboard for a bug in the Scouts reader, and does not list it as a problem", async () => {
  const c = await core();
  expect(
    (await c.mutate("vault.open", { path: await tmp("loose-ends-bug") })).error
  ).toBeUndefined();
  await c.indexed();

  const reply = await c.query("looseEnds.rows");

  expect(reply.result).toBeUndefined();
  expect(reply.error?.message).toBe("a bug in the reader");
});
