import type { CoreMessage, ShellMessage } from "core";
import { describe, expect, it } from "vitest";
import { closeCore, type CorePort } from "./close.js";

/** The core's channel as a plain object: what it was asked, and what it says back. */
function fakeCore() {
  const posted: ShellMessage[] = [];
  const messages: Array<(message: CoreMessage) => void> = [];
  const exits: Array<() => void> = [];
  const port: CorePort = {
    postMessage: (message) => posted.push(message),
    onMessage: (listener) => {
      messages.push(listener);
      return () => messages.splice(messages.indexOf(listener), 1);
    },
    onExit: (listener) => {
      exits.push(listener);
      return () => exits.splice(exits.indexOf(listener), 1);
    },
  };
  return {
    port,
    posted,
    /** Listeners still registered: a close that has settled leaves none. */
    listening: () => messages.length + exits.length,
    say: (message: CoreMessage) => {
      for (const listener of [...messages]) listener(message);
    },
    exit: () => {
      for (const listener of [...exits]) listener();
    },
  };
}

describe("closeCore", () => {
  it("asks the core to close and resolves on its answer", async () => {
    const core = fakeCore();
    const closing = closeCore(core.port);
    expect(core.posted).toEqual([{ type: "close" }]);

    core.say({ type: "closed" });
    expect(await closing).toBe("closed");
    expect(core.listening()).toBe(0);
  });

  it("keeps waiting through a message that is not the answer", async () => {
    const core = fakeCore();
    const closing = closeCore(core.port, 1000);

    core.say({ type: "pickFolder", id: 1 });
    core.say({ type: "closed" });
    expect(await closing).toBe("closed");
  });

  // The bound is the whole point: what could not be spliced stays in
  // `queue.sqlite` and is owed again at the next open, so quitting anyway
  // loses nothing — whereas a quit that never finishes is the app hanging.
  it("gives up once the bound has passed, so a hung close never stops the quit", async () => {
    const core = fakeCore();
    expect(await closeCore(core.port, 5)).toBe("gaveUp");
    expect(core.listening()).toBe(0);
  });

  it("stops waiting when the core goes without answering", async () => {
    const core = fakeCore();
    const closing = closeCore(core.port, 1000);

    core.exit();
    expect(await closing).toBe("gone");
    expect(core.listening()).toBe(0);
  });
});
