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
  it("answers a board's badges with one call for the whole batch", async () => {
    const host = createTestHost({
      context: { slot: { kind: "badges", id: "badges" } },
      handlers: {
        "issueData.list": () => ({
          "i-1": [
            {
              key: "pr:acme:web:42",
              value: {
                kind: "pull_request",
                repo: "acme/web",
                number: 42,
                title: "Keep the cookie",
                state: "open",
                review: "approved",
                url: null,
                branch: "web-1",
                base: "main",
                author: "ada",
                additions: null,
                deletions: null,
                at: "2026-11-19T10:00:00Z",
              },
              updatedAt: "2026-11-19T10:00:00Z",
            },
          ],
        }),
      },
    });
    const { plugin, unload } = await loadPlugin(GitHub, host);
    const badges = await host.badges([
      { id: "i-1", ref: "WEB-1" },
      { id: "i-2", ref: "WEB-2" },
    ]);
    expect(host.calls).toEqual([
      { method: "issueData.list", params: { issueIds: ["i-1", "i-2"] } },
    ]);
    expect(Object.keys(badges)).toEqual(["i-1"]);
    expect(badges["i-1"][0]).toMatchObject({ text: "#42 Approved" });
    expect(plugin).toBeDefined();
    await unload();
  });

  it("lets Barynt read GitHub's webhooks, with no server of its own", () => {
    const [hook] = manifest.contributes.inboundHooks;
    expect(hook).toMatchObject({
      id: "github",
      provider: "github",
      handle: "link",
    });
    // Rules Barynt runs as the plugin's app (BARY-227): it may set a status.
    expect(hook.rules.map((r) => r.on)).toEqual([
      "pull_request.opened",
      "pull_request.merged",
    ]);
    expect(manifest.capabilities).toContain("issues:write");
    expect("service" in manifest).toBe(false);
  });
});
