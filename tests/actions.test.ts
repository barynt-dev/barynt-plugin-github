import { describe, expect, it } from "bun:test";
import { createTestHost, loadPlugin } from "@barynt/plugin-sdk/testing";
import GitHub from "../src/main";

// The issue's actions (BARY-230) against the SDK's test host — GitHub's
// API stands in through `net.fetch`.

type Net = { url: string; method?: string; body?: string };
const issue = { id: "i-1", ref: "NIM-42", title: "Keep the cookie" };

function host(options: {
  settings?: Record<string, unknown>;
  entries?: unknown[];
  github?: (req: Net) => { status: number; body?: unknown };
}) {
  return createTestHost({
    context: { slot: { kind: "actions", id: "actions" } },
    handlers: {
      "settings.get": () =>
        ({
          branchPattern: "{user}/{key}-{title}",
          branchAssign: true,
          ...options.settings,
        }) as never,
      "issues.get": () => issue as never,
      "issues.update": () => ({ id: "i-1" }),
      "issueData.list": () =>
        ({
          "i-1": (options.entries ?? []).map((value, i) => ({
            key: `k${i}`,
            value,
            updatedAt: "",
          })),
        }) as never,
      "net.fetch": (req) => {
        if (!options.github) throw new Error("credential_missing");
        const res = options.github(req as Net);
        return {
          status: res.status,
          headers: {},
          text: res.body === undefined ? "" : JSON.stringify(res.body),
        };
      },
    },
  });
}

/** A GitHub where `taken` branch names exist already. */
function fakeGitHub(taken: string[] = [], log: Net[] = []) {
  return (req: Net) => {
    log.push(req);
    const path = req.url.replace("https://api.github.com", "");
    if (path === "/user") return { status: 200, body: { login: "ada" } };
    if (path === "/repos/acme/web")
      return { status: 200, body: { default_branch: "main" } };
    if (path === "/repos/acme/web/git/ref/heads/main")
      return { status: 200, body: { object: { sha: "abc" } } };
    if (path === "/repos/acme/web/git/refs" && req.method === "POST") {
      const ref = JSON.parse(req.body ?? "{}").ref.replace("refs/heads/", "");
      return taken.includes(ref)
        ? { status: 422, body: { message: "Reference already exists" } }
        : { status: 201, body: {} };
    }
    return { status: 404 };
  };
}

describe("Create branch", () => {
  it("creates it from the default branch, assigns the issue and sets its status", async () => {
    const log: Net[] = [];
    const h = host({
      settings: { repositories: "acme/web", branchStatus: "in_progress" },
      github: fakeGitHub(["ada/nim-42-keep-the-cookie"], log),
    });
    await loadPlugin(GitHub, h);
    const result = await h.runAction("create-branch", { issueId: "i-1" });
    expect(result).toMatchObject({
      message: "Branch ada/nim-42-keep-the-cookie-2 created in acme/web.",
      tone: "success",
      openPanel: "development",
    });
    expect(JSON.parse(log.at(-1)?.body ?? "{}")).toEqual({
      ref: "refs/heads/ada/nim-42-keep-the-cookie-2",
      sha: "abc",
    });
    expect(h.calls.at(-1)).toEqual({
      method: "issues.update",
      params: { id: "i-1", assignee: "me", status: "in_progress" },
    });
  });

  it("says what's missing: a repository, a connection or token, write access", async () => {
    const noRepo = host({ github: fakeGitHub() });
    await loadPlugin(GitHub, noRepo);
    expect(
      (await noRepo.runAction("create-branch", { issueId: "i-1" }))?.message,
    ).toContain("Pick a repository");

    const noToken = host({ settings: { repositories: "acme/web" } });
    await loadPlugin(GitHub, noToken);
    expect(
      (await noToken.runAction("create-branch", { issueId: "i-1" }))?.message,
    ).toContain("Connect GitHub");

    const readOnly = host({
      settings: { repositories: "acme/web" },
      github: (req) =>
        req.method === "POST" ? { status: 403 } : fakeGitHub()(req),
    });
    await loadPlugin(GitHub, readOnly);
    expect(
      (await readOnly.runAction("create-branch", { issueId: "i-1" }))?.message,
    ).toContain("No right to write");
  });
});

describe("Copy branch name and Open pull request", () => {
  const branch = {
    kind: "branch",
    repo: "acme/web",
    name: "ada/nim-42-cookie",
    url: null,
    deleted: false,
    at: "2026-11-19T10:00:00Z",
  };

  it("copies the branch Barynt knows, else the name it would get", async () => {
    const known = host({ entries: [branch] });
    await loadPlugin(GitHub, known);
    expect(
      await known.runAction("copy-branch-name", { issueId: "i-1" }),
    ).toMatchObject({
      copy: "ada/nim-42-cookie",
    });
    const fresh = host({ github: fakeGitHub() });
    await loadPlugin(GitHub, fresh);
    expect(
      await fresh.runAction("copy-branch-name", { issueId: "i-1" }),
    ).toMatchObject({
      copy: "ada/nim-42-keep-the-cookie",
    });
  });

  it("opens the open pull request, else GitHub's compare page, else says so", async () => {
    const pr = {
      kind: "pull_request",
      repo: "acme/web",
      number: 7,
      title: "x",
      state: "open",
      review: null,
      url: "https://github.com/acme/web/pull/7",
      branch: "ada/nim-42-cookie",
      base: "main",
      author: "ada",
      additions: null,
      deletions: null,
      at: "2026-11-19T11:00:00Z",
    };
    const withPr = host({ entries: [branch, pr] });
    await loadPlugin(GitHub, withPr);
    expect(
      await withPr.runAction("open-pull-request", { issueId: "i-1" }),
    ).toEqual({
      open: "https://github.com/acme/web/pull/7",
    });
    const onlyBranch = host({ entries: [branch] });
    await loadPlugin(GitHub, onlyBranch);
    expect(
      (await onlyBranch.runAction("open-pull-request", { issueId: "i-1" }))
        ?.open,
    ).toBe(
      "https://github.com/acme/web/compare/ada/nim-42-cookie?expand=1&title=NIM-42%3A%20Keep%20the%20cookie",
    );
    const nothing = host({});
    await loadPlugin(GitHub, nothing);
    expect(
      (await nothing.runAction("open-pull-request", { issueId: "i-1" }))?.tone,
    ).toBe("warning");
  });
});
