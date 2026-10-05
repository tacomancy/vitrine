import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { ANTHROPIC } from "./credentials.js";
import { DEFAULT_MODEL } from "./model-provider.js";

/**
 * What the app remembers about a Provider besides the key: its model id, an
 * editable string and not a catalogue (ADR 0017 decision 4). It lives in
 * `providers.json` in the core's own folder — never in the vault, which is
 * the researcher's, and never beside the key, which is the Keychain's.
 */

export type ProviderSettings = {
  model: () => Promise<string>;
  setModel: (model: string) => Promise<void>;
};

export function createProviderSettings(
  appSupportDir: string
): ProviderSettings {
  const file = join(appSupportDir, "providers.json");
  return {
    // Read at each use, so an edit reaches the next run with no restart. A
    // file that is missing or does not read is the default: the setting is
    // a convenience, and a bad file must not stop a Scout from looking.
    model: async () => {
      try {
        const parsed = JSON.parse(await readFile(file, "utf8")) as {
          [ANTHROPIC]?: { model?: unknown };
        };
        const model = parsed[ANTHROPIC]?.model;
        return typeof model === "string" && model.trim() !== ""
          ? model
          : DEFAULT_MODEL;
      } catch {
        return DEFAULT_MODEL;
      }
    },
    setModel: (model) =>
      writeAtomically(
        file,
        `${JSON.stringify({ [ANTHROPIC]: { model } }, null, 2)}\n`
      ),
  };
}
