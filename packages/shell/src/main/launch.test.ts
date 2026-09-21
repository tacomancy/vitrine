import { describe, expect, it } from "vitest";
import { buildVersion, coreEntry, stateFolder } from "./launch.js";

describe("coreEntry", () => {
  it("is the staged core under resourcesPath when packaged", () => {
    expect(
      coreEntry({
        isPackaged: true,
        resourcesPath: "/Applications/Vitrine.app/Contents/Resources",
        mainDir: "/Applications/Vitrine.app/Contents/Resources/app/out/main",
      })
    ).toBe("/Applications/Vitrine.app/Contents/Resources/core/dist/main.js");
  });

  it("is the workspace core beside the shell otherwise", () => {
    expect(
      coreEntry({
        isPackaged: false,
        resourcesPath:
          "/somewhere/electron/dist/Electron.app/Contents/Resources",
        mainDir: "/repo/packages/shell/out/main",
      })
    ).toBe("/repo/packages/core/dist/main.js");
  });
});

describe("stateFolder", () => {
  const appData = "/Users/someone/Library/Application Support";

  it("is the explicit VITRINE_APP_SUPPORT_DIR whenever one is set", () => {
    for (const isPackaged of [true, false]) {
      expect(
        stateFolder({ explicit: "/tmp/vitrine-support-x", isPackaged, appData })
      ).toBe("/tmp/vitrine-support-x");
    }
  });

  it("is Application Support/Vitrine for the packaged app", () => {
    expect(
      stateFolder({ explicit: undefined, isPackaged: true, appData })
    ).toBe("/Users/someone/Library/Application Support/Vitrine");
  });

  it("is Application Support/Vitrine (dev) for anything else", () => {
    expect(
      stateFolder({ explicit: undefined, isPackaged: false, appData })
    ).toBe("/Users/someone/Library/Application Support/Vitrine (dev)");
  });

  it("treats an empty VITRINE_APP_SUPPORT_DIR as unset", () => {
    expect(stateFolder({ explicit: "", isPackaged: false, appData })).toBe(
      "/Users/someone/Library/Application Support/Vitrine (dev)"
    );
  });
});

describe("buildVersion", () => {
  it("is the short sha for a clean tree", () => {
    expect(buildVersion({ sha: "559ddf8", status: "" })).toBe("559ddf8");
  });

  it("appends -dirty when git status reports anything", () => {
    expect(
      buildVersion({
        sha: "559ddf8",
        status: " M packages/shell/src/main/index.ts\n",
      })
    ).toBe("559ddf8-dirty");
  });

  it("trims the sha and status as git prints them", () => {
    expect(buildVersion({ sha: "559ddf8\n", status: "\n" })).toBe("559ddf8");
  });
});
