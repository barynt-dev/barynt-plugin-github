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

  it("draws the Development panel, reviews with the person's token", async () => {
    const pr = {
      kind: "pull_request",
      repo: "acme/web",
      number: 42,
      title: "Keep the cookie",
      state: "open",
      review: null,
      url: "https://github.com/acme/web/pull/42",
      branch: "web-1",
      base: "main",
      author: "ada",
      additions: 120,
      deletions: 34,
      at: "2026-11-19T10:00:00Z",
    };
    const panel = (net: () => unknown) => {
      const root = document.createElement("div");
      return {
        root,
        host: createTestHost({
          root: root as unknown as HTMLElement,
          context: {
            slot: { kind: "issuePanel", id: "development" },
            issueId: "i-1",
          },
          handlers: {
            "issueData.list": () => ({
              "i-1": [{ key: "pr", value: pr, updatedAt: pr.at }],
            }),
            "net.fetch": net as never,
          },
        }),
      };
    };
    const settle = () => new Promise((r) => setTimeout(r, 0));
    // Who reviewed loads when its details open.
    const openDetails = (root: { querySelector: (s: string) => unknown }) => {
      const details = root.querySelector("details.bui-card-more") as {
        open: boolean;
        dispatchEvent: (e: unknown) => void;
        ownerDocument: { defaultView: { Event: new (t: string) => unknown } };
      };
      details.open = true;
      details.dispatchEvent(
        new details.ownerDocument.defaultView.Event("toggle"),
      );
    };

    const withToken = panel(() => ({
      status: 200,
      headers: {},
      text: JSON.stringify([{ user: { login: "tom" }, state: "APPROVED" }]),
    }));
    await loadPlugin(GitHub, withToken.host);
    await settle();
    // One repository: the number alone.
    expect(withToken.root.textContent).toContain("#42 Keep the cookie");
    expect(withToken.root.textContent).toContain("Waiting for a review");
    expect(withToken.root.textContent).not.toContain("tom");
    openDetails(withToken.root);
    await settle();
    expect(withToken.root.textContent).toContain("tom");
    expect(
      withToken.host.calls.find((c) => c.method === "net.fetch"),
    ).toMatchObject({
      method: "net.fetch",
      params: {
        url: "https://api.github.com/repos/acme/web/pulls/42/reviews?per_page=100",
      },
    });

    const noToken = panel(() => {
      // As Barynt refuses a request without the person's token.
      throw new Error("credential_missing");
    });
    await loadPlugin(GitHub, noToken.host);
    await settle();
    openDetails(noToken.root);
    await settle();
    expect(noToken.root.textContent).toContain("or keep your own token");
  });

  it("with nothing linked, says where to start", async () => {
    const panel = (
      repositories: string[],
      net: () => unknown,
    ): { root: HTMLElement; host: ReturnType<typeof createTestHost> } => {
      const root = document.createElement("div") as unknown as HTMLElement;
      return {
        root,
        host: createTestHost({
          root,
          context: {
            slot: { kind: "issuePanel", id: "development" },
            issueId: "i-1",
          },
          handlers: {
            "issueData.list": () => ({ "i-1": [] }),
            "settings.get": () => ({ repositories }),
            "issues.get": () =>
              ({
                id: "i-1",
                ref: "MOB-2",
                title: "Add a timer",
                type: null,
              }) as never,
            "net.fetch": net as never,
          },
        }),
      };
    };
    const settle = () => new Promise((r) => setTimeout(r, 0));
    const click = (root: HTMLElement, label: string) =>
      (
        [...root.querySelectorAll("button")].find((b) =>
          b.textContent?.includes(label),
        ) as unknown as { click: () => void }
      ).click();

    // No repository: the project's settings.
    const noRepo = panel([], () => ({ status: 200, headers: {}, text: "{}" }));
    await loadPlugin(GitHub, noRepo.host);
    await settle();
    expect(noRepo.root.textContent).toContain("No repository set");
    click(noRepo.root, "Connect repository");
    expect(noRepo.host.openedSettings).toEqual(["project"]);

    // No way into GitHub: the person's.
    const noAccess = panel(["acme/web"], () => {
      throw new Error("credential_missing");
    });
    await loadPlugin(GitHub, noAccess.host);
    await settle();
    expect(noAccess.root.textContent).toContain("No access to GitHub");
    click(noAccess.root, "Connect GitHub");
    expect(noAccess.host.openedSettings).toEqual(["personal"]);

    // Else: create one — or copy its name.
    const ready = panel(["acme/web"], () => ({
      status: 200,
      headers: {},
      text: "{}",
    }));
    await loadPlugin(GitHub, ready.host);
    await settle();
    expect(ready.root.textContent).toContain("Create branch");
    expect(ready.root.textContent?.toLowerCase()).toContain("mob-2");
    click(ready.root, "Create branch");
    expect(ready.host.started).toEqual([{ actionId: "create-branch" }]);
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
      "pull_request.draft",
      "pull_request.opened",
      "pull_request.review_requested",
      "pull_request.approved",
      "pull_request.changes_requested",
      "pull_request.merged",
      "pull_request.closed",
      "checks.failed",
      "deployment.test",
      "deployment.production",
    ]);
    expect(manifest.capabilities).toContain("issues:write");
    expect("service" in manifest).toBe(false);
  });
});
