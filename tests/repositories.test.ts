import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestHost, loadPlugin } from "@barynt/plugin-sdk/testing";
import { Window } from "happy-dom";
import GitHub from "../src/main";
import { checkRepository, describeCheck } from "../src/repositories";

// The settings' check of the repositories on GitHub (BARY-231).

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

type Reply = { status: number; body?: unknown } | "no-token";
const api = (reply: (url: string) => Reply) =>
  createTestHost({
    handlers: {
      "net.fetch": ({ url }) => {
        const r = reply(url);
        if (r === "no-token") throw new Error("credential_missing");
        return {
          status: r.status,
          headers: {},
          text: r.body === undefined ? "" : JSON.stringify(r.body),
        };
      },
    },
  });

async function check(reply: Reply) {
  const host = api(() => reply);
  const { plugin } = await loadPlugin(GitHub, host);
  return checkRepository(plugin.api, "acme/web");
}

describe("checking a repository", () => {
  it("tells ready from read-only, missing, a bad token and none", async () => {
    expect(
      await check({
        status: 200,
        body: {
          default_branch: "trunk",
          private: true,
          html_url: "https://github.com/acme/web",
          permissions: { push: true },
        },
      }),
    ).toEqual({
      repo: "acme/web",
      state: "ok",
      defaultBranch: "trunk",
      private: true,
      url: "https://github.com/acme/web",
    });
    expect(
      (await check({ status: 200, body: { permissions: { push: false } } }))
        .state,
    ).toBe("read-only");
    expect((await check({ status: 404 })).state).toBe("missing");
    expect((await check({ status: 401 })).state).toBe("bad-token");
    expect((await check("no-token")).state).toBe("no-token");
    expect(await check({ status: 502 })).toEqual({
      repo: "acme/web",
      state: "error",
      status: 502,
    });
  });

  it("says it in a few words", () => {
    expect(
      describeCheck({
        repo: "a/b",
        state: "read-only",
        defaultBranch: "main",
        private: false,
        url: "",
      }),
    ).toEqual({
      text: "Read only — no branches",
      tone: "warning",
    });
  });
});

describe("the settings section", () => {
  it("lists the saved repositories as GitHub sees them, and a branch's name", async () => {
    const root = document.createElement("div");
    const host = createTestHost({
      root: root as unknown as HTMLElement,
      context: { slot: { kind: "settings", id: "section" } },
      handlers: {
        "settings.get": () =>
          ({
            repositories: "acme/web\nacme/gone",
            branchPattern: "{user}/{key}-{title}",
          }) as never,
        "net.fetch": ({ url }) => {
          if (url.endsWith("/user"))
            return {
              status: 200,
              headers: {},
              text: JSON.stringify({ login: "ada" }),
            };
          if (url.endsWith("/repos/acme/web"))
            return {
              status: 200,
              headers: {},
              text: JSON.stringify({
                default_branch: "main",
                permissions: { push: true },
              }),
            };
          return { status: 404, headers: {}, text: "" };
        },
      },
    });
    await loadPlugin(GitHub, host);
    await new Promise((r) => setTimeout(r, 0));
    const shown = root.textContent ?? "";
    expect(shown).toContain("acme/web");
    expect(shown).toContain("Ready");
    expect(shown).toContain("Not found for your token");
    expect(shown).toContain("ada/web-42-keep-the-session-cookie");
  });
});
