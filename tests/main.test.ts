import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestHost, loadPlugin } from "@barynt/plugin-sdk/testing";
import { Window } from "happy-dom";
import manifest from "../manifest.json";
import GitHub from "../src/main";

// The plugin against the SDK's test host. Barynt reads GitHub's webhooks
// itself (`handle: "link"`); the plugin draws what it keeps on the issues.

const g = globalThis as { document?: unknown };
let window: Window;
beforeAll(() => {
  window = new Window();
  g.document = window.document;
});
afterAll(async () => {
  delete g.document;
  await window.happyDOM.close();
});

describe("the GitHub plugin", () => {
  it("loads, and asks Barynt for nothing yet", async () => {
    const host = createTestHost();
    const { unload } = await loadPlugin(GitHub, host);
    expect(host.calls).toEqual([]);
    await unload();
  });

  it("lets Barynt read GitHub's webhooks, with no server of its own", () => {
    expect(manifest.contributes.inboundHooks).toEqual([
      {
        id: "github",
        title: "GitHub repository",
        provider: "github",
        handle: "link",
      },
    ]);
    expect("service" in manifest).toBe(false);
  });
});
