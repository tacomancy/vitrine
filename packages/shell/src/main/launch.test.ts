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
  it("is the describe string for a clean tree", () => {
    expect(buildVersion({ described: "beat-2-39-g5f08a59", status: "" })).toBe(
      "beat-2-39-g5f08a59"
    );
  });

  it("appends -dirty when git status reports anything", () => {
    expect(
      buildVersion({
        described: "beat-2-39-g5f08a59",
        status: " M packages/shell/src/main/index.ts\n",
      })
    ).toBe("beat-2-39-g5f08a59-dirty");
  });

  // `git describe --always` in a clone with no tags fetched: a bare sha, which
  // the resolver must pass through rather than treat as a missing identity.
  it("is the bare sha when describe found no tag to describe against", () => {
    expect(buildVersion({ described: "559ddf8", status: "" })).toBe("559ddf8");
    expect(
      buildVersion({ described: "559ddf8", status: "?? Scripts/x.mjs\n" })
    ).toBe("559ddf8-dirty");
  });

  it("trims the describe string and status as git prints them", () => {
    expect(buildVersion({ described: "beat-2b\n", status: "\n" })).toBe(
      "beat-2b"
    );
  });
});
