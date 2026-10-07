import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

// Settings' third section, *What it talks to* (#465; spec #463 stories 1–9,
// 13, 19; prototype 13): one block for Anthropic over `credentials.status |
// set | delete | test`, each state drawn from the fake core's answers.

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

const KEY = "sk-ant-secret-1234567890";

const answers = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "vault.status": {
    indexing: null,
    watching: { ok: true, since: new Date(2026, 8, 28, 8, 40).toISOString() },
    current: { ok: true },
  },
  "vault.pdfFolder": {
    exists: true,
    link: null,
    resolves: { path: `${vault.path}/sources/pdf`, known: null },
    holds: { count: 0, bytes: 0 },
    lastArrived: null,
    fault: null,
  },
  "vault.kinds": [],
  "questions.list": empty,
  "globalCommand.destinations": { rows: [] },
  "credentials.status": { state: "absent" },
  "credentials.model": { model: "claude-opus-5" },
  "credentials.waiting": [],
  ...more,
});

/** The section, once Settings has rendered it. */
async function talks() {
  window.location.hash = "#/settings";
  return await screen.findByRole("region", { name: "What it talks to" });
}

/** A row's value, by its label. */
function row(section: HTMLElement, label: string): string {
  return (
    within(section).getByText(label, { selector: "dt" }).nextElementSibling
      ?.textContent ?? ""
  );
}

describe("Settings: what it talks to", () => {
  it("says what is true when no key is stored, and offers to store one", async () => {
    renderApp(answers());
    const section = await talks();
    expect(within(section).getByText("Anthropic")).toBeTruthy();
    await vi.waitFor(() =>
      expect(row(section, "Key")).toMatch(/no key stored/i)
    );
    expect(
      within(section).getByLabelText<HTMLInputElement>("Key")
    ).toBeTruthy();
    // Nothing to remove or test when there is nothing stored.
    expect(
      within(section).queryByRole("button", { name: "Remove" })
    ).toBeNull();
    expect(within(section).queryByRole("button", { name: "Test" })).toBeNull();
    // One Provider, and no way to add another.
    expect(section.textContent).not.toMatch(/add a provider/i);
  });

  it("states a stored key without ever showing it", async () => {
    renderApp(answers({ "credentials.status": { state: "present" } }));
    const section = await talks();
    await vi.waitFor(() =>
      expect(row(section, "Key")).toMatch(/a key is stored/i)
    );
    const field = within(section).getByLabelText<HTMLInputElement>("Key");
    expect(field.value).toBe("");
    expect(field.type).toBe("password");
    expect(section.textContent).not.toContain("sk-");
    expect(
      within(section).getByRole("button", { name: "Remove" })
    ).toBeTruthy();
  });

  it("sends a typed key once, clears the field, and re-reads the state", async () => {
    let state = "absent";
    const set = vi.fn((input: unknown) => {
      state = "present";
      return input;
    });
    renderApp(
      answers({
        "credentials.status": () => ({ state }),
        "credentials.set": set,
      })
    );
    const section = await talks();
    const field = await within(section).findByLabelText("Key");
    fireEvent.change(field, { target: { value: KEY } });
    fireEvent.click(within(section).getByRole("button", { name: "Store" }));
    await vi.waitFor(() =>
      expect(set).toHaveBeenCalledWith({ provider: "anthropic", key: KEY })
    );
    await vi.waitFor(() =>
      expect(row(section, "Key")).toMatch(/a key is stored/i)
    );
    expect(within(section).getByLabelText<HTMLInputElement>("Key").value).toBe(
      ""
    );
    expect(section.textContent).not.toContain(KEY);
  });

  it("will not send an empty key", async () => {
    const set = vi.fn();
    renderApp(answers({ "credentials.set": set }));
    const section = await talks();
    const button = await within(section).findByRole("button", {
      name: "Store",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("replaces a stored key from the same field, and removes it", async () => {
    let state = "present";
    const del = vi.fn(() => {
      state = "absent";
      return null;
    });
    renderApp(
      answers({
        "credentials.status": () => ({ state }),
        "credentials.set": vi.fn(),
        "credentials.delete": del,
      })
    );
    const section = await talks();
    await within(section).findByRole("button", { name: "Replace" });
    fireEvent.click(within(section).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(del).toHaveBeenCalledWith({ provider: "anthropic" })
    );
    await vi.waitFor(() =>
      expect(row(section, "Key")).toMatch(/no key stored/i)
    );
  });

  it("says a Keychain fault as one, never as no key", async () => {
    renderApp(
      answers({
        "credentials.status": {
          state: "fault",
          reason: "The Keychain could not be used: it may be locked.",
        },
      })
    );
    const section = await talks();
    await vi.waitFor(() =>
      expect(row(section, "Key")).toContain("The Keychain could not be used")
    );
    expect(section.textContent).not.toMatch(/no key stored/i);
  });

  it("states a refused store as a sentence on the row", async () => {
    renderApp(
      answers({
        "credentials.set": () => {
          throw new Error("The Keychain could not be used: it may be locked.");
        },
      })
    );
    const section = await talks();
    fireEvent.change(await within(section).findByLabelText("Key"), {
      target: { value: KEY },
    });
    fireEvent.click(within(section).getByRole("button", { name: "Store" }));
    expect((await within(section).findByRole("alert")).textContent).toContain(
      "Keychain"
    );
    expect(section.textContent).not.toContain(KEY);
  });

  describe("test", () => {
    const tested = async (result: unknown, status = "present") => {
      renderApp(
        answers({
          "credentials.status": { state: status },
          "credentials.test": result,
        })
      );
      const section = await talks();
      fireEvent.click(
        await within(section).findByRole("button", { name: "Test" })
      );
      return section;
    };

    it("says it worked", async () => {
      const section = await tested({ result: "ok" });
      await vi.waitFor(() => expect(row(section, "Test")).toMatch(/worked/));
    });

    it("says key rejected, in the key's state too", async () => {
      const section = await tested({ result: "rejected" });
      await vi.waitFor(() =>
        expect(row(section, "Key")).toMatch(/key rejected/i)
      );
      expect(row(section, "Test")).toMatch(/refused|rejected/i);
    });

    it("says the provider could not be reached, and leaves the key's state alone", async () => {
      const section = await tested({ result: "unreachable" });
      await vi.waitFor(() =>
        expect(row(section, "Test")).toMatch(/could not be reached/i)
      );
      expect(row(section, "Key")).toMatch(/a key is stored/i);
    });

    it("says there is no key to test", async () => {
      const section = await tested({ result: "no-key" });
      await vi.waitFor(() =>
        expect(row(section, "Test")).toMatch(/no key stored/i)
      );
    });

    it("says a Keychain fault", async () => {
      const section = await tested({
        result: "fault",
        reason: "The Keychain could not be used: it may be locked.",
      });
      await vi.waitFor(() => expect(row(section, "Test")).toMatch(/Keychain/));
    });
  });

  describe("the model id", () => {
    it("shows the stored id as editable text and saves an edit", async () => {
      const setModel = vi.fn();
      renderApp(
        answers({
          "credentials.model": { model: "claude-opus-5" },
          "credentials.setModel": setModel,
        })
      );
      const section = await talks();
      const field =
        await within(section).findByLabelText<HTMLInputElement>("Model");
      await vi.waitFor(() => expect(field.value).toBe("claude-opus-5"));
      fireEvent.change(field, { target: { value: "claude-sonnet-5" } });
      fireEvent.click(
        within(section).getByRole("button", { name: "Save model" })
      );
      await vi.waitFor(() =>
        expect(setModel).toHaveBeenCalledWith({
          provider: "anthropic",
          model: "claude-sonnet-5",
        })
      );
    });
  });
});

describe("Settings: the Scouts waiting on the key (#468)", () => {
  const waiting = [
    { id: "lab", name: "Sleep Lab", message: "no key" },
    { id: "other", name: "Other Lab", message: "key rejected" },
  ];

  it("names each waiting Scout as a link to the Scouts surface, and never counts them", async () => {
    renderApp(answers({ "credentials.waiting": waiting }));
    const section = await talks();

    const lab = await within(section).findByRole("link", { name: "Sleep Lab" });
    expect(lab.getAttribute("href")).toBe("#/scouts");
    expect(
      within(section).getByRole("link", { name: "Other Lab" })
    ).toBeTruthy();
    expect(row(section, "Waiting")).toMatch(/not yet/i);
    // The rejected key is said as a fault, beside its Scout.
    expect(row(section, "Waiting")).toMatch(/key rejected/);
    expect(section.textContent).not.toMatch(/\b[12] (scouts?|waiting)\b/i);
  });

  it("draws no row when nothing is waiting", async () => {
    renderApp(answers());
    const section = await talks();
    await vi.waitFor(() => expect(row(section, "Key")).toMatch(/no key/i));
    expect(
      within(section).queryByText("Waiting", { selector: "dt" })
    ).toBeNull();
  });
});

describe("Settings: a waiting list that could not be read (#527)", () => {
  it("says why on a polite footer line, and draws no list", async () => {
    renderApp(
      answers({
        "credentials.waiting": () => {
          throw new Error("scouts unreadable");
        },
      })
    );
    await talks();
    const page = await screen.findByRole("region", { name: "Settings" });

    const footer = await within(page).findByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ not read — scouts unreadable"
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Waiting", { selector: "dt" })).toBeNull();
  });
});
