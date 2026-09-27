import { describe, expect, it } from "vitest";
import { pickFolder, type ShowOpenDialog } from "./chooser.js";

type Asked = Parameters<ShowOpenDialog>[0];

/** A chooser that records what it was asked for and answers as told. */
function fakeDialog(answer: { canceled: boolean; filePaths: string[] }) {
  const asked: Asked[] = [];
  const show: ShowOpenDialog = (options) => {
    asked.push(options);
    return Promise.resolve(answer);
  };
  return { show, asked };
}

describe("pickFolder", () => {
  it("asks for a chooser that opens a folder and can also make one", async () => {
    const dialog = fakeDialog({ canceled: false, filePaths: ["/v/fresh"] });

    await pickFolder(dialog.show);

    expect(dialog.asked).toEqual([
      { properties: ["openDirectory", "createDirectory"] },
    ]);
  });

  it("answers with the chosen folder", async () => {
    const dialog = fakeDialog({ canceled: false, filePaths: ["/v/fresh"] });
    expect(await pickFolder(dialog.show)).toBe("/v/fresh");
  });

  it("answers null when the chooser is cancelled", async () => {
    const dialog = fakeDialog({ canceled: true, filePaths: [] });
    expect(await pickFolder(dialog.show)).toBeNull();
  });

  it("answers null rather than undefined when a chooser confirms with no path", async () => {
    const dialog = fakeDialog({ canceled: false, filePaths: [] });
    expect(await pickFolder(dialog.show)).toBeNull();
  });
});
