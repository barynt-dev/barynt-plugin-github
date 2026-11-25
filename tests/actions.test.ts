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
      "issueData.set": () => null,
      "issueData.delete": () => null,
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
  it("asks which repository with several, then creates it in the one picked", async () => {
    const log: Net[] = [];
    const h = host({
      settings: { repositories: ["acme/api", "acme/web"] },
      github: fakeGitHub([], log),
    });
    await loadPlugin(GitHub, h);
    const asked = await h.runAction("create-branch", { issueId: "i-1" });
    expect(asked).toMatchObject({
      pick: {
        options: [
          { id: "acme/api", label: "acme/api" },
          { id: "acme/web", label: "acme/web" },
        ],
      },
    });
    expect(log).toHaveLength(0);
    const done = await h.runAction("create-branch", {
      issueId: "i-1",
      choice: "acme/web",
      values: {},
    });
    expect(done).toMatchObject({ tone: "success" });
    expect(log.some((r) => r.url.endsWith("/repos/acme/web/git/refs"))).toBe(
      true,
    );
  });

  it("never creates it in a repository the project doesn't work with", async () => {
    const log: Net[] = [];
    const h = host({
      settings: { repositories: ["acme/web", "acme/api"] },
      github: fakeGitHub([], log),
    });
    await loadPlugin(GitHub, h);
    await h.runAction("create-branch", {
      issueId: "i-1",
      choice: "evil/repo",
      values: {},
    });
    expect(log.some((r) => r.url.includes("evil/repo"))).toBe(false);
    expect(log.some((r) => r.url.endsWith("/repos/acme/web/git/refs"))).toBe(
      true,
    );
  });

  it("creates it from the default branch, assigns the issue and sets its status", async () => {
    const log: Net[] = [];
    const h = host({
      settings: { repositories: "acme/web", branchStatus: "in_progress" },
      github: fakeGitHub(["ada/nim-42-keep-the-cookie"], log),
    });
    await loadPlugin(GitHub, h);
    const result = await h.runAction("create-branch", {
      issueId: "i-1",
      values: {},
    });
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

  it("asks its name and the branch it starts from in a window first", async () => {
    const h = host({
      settings: { repositories: "acme/web" },
      github: (req) => {
        if (req.url.endsWith("/repos/acme/web/branches?per_page=100"))
          return { status: 200, body: [{ name: "main" }, { name: "develop" }] };
        return fakeGitHub()(req);
      },
    });
    await loadPlugin(GitHub, h);
    const asked = await h.runAction("create-branch", { issueId: "i-1" });
    expect(asked.form?.fields).toEqual([
      expect.objectContaining({
        id: "name",
        value: "ada/nim-42-keep-the-cookie",
      }),
      expect.objectContaining({
        id: "base",
        type: "select",
        options: [
          { id: "main", label: "main" },
          { id: "develop", label: "develop" },
        ],
      }),
    ]);
  });

  it("creates it under the name set, from the branch picked, and keeps it on the issue", async () => {
    const log: Net[] = [];
    const h = host({
      settings: { repositories: "acme/web", branchAssign: false },
      github: (req) => {
        log.push(req);
        if (req.url.endsWith("/git/ref/heads/develop"))
          return { status: 200, body: { object: { sha: "dev" } } };
        return fakeGitHub()(req);
      },
    });
    await loadPlugin(GitHub, h);
    await h.runAction("create-branch", {
      issueId: "i-1",
      values: { name: "nim-42-spike", base: "develop" },
    });
    expect(JSON.parse(log.at(-1)?.body ?? "{}")).toEqual({
      ref: "refs/heads/nim-42-spike",
      sha: "dev",
    });
    const kept = h.calls.find((c) => c.method === "issueData.set");
    expect(kept?.params).toMatchObject({
      issueId: "i-1",
      value: { kind: "branch", repo: "acme/web", name: "nim-42-spike" },
    });
  });

  it("won't take a name Git doesn't", async () => {
    const h = host({
      settings: { repositories: "acme/web" },
      github: fakeGitHub(),
    });
    await loadPlugin(GitHub, h);
    const result = await h.runAction("create-branch", {
      issueId: "i-1",
      values: { name: "two words" },
    });
    expect(result.tone).toBe("warning");
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
      (
        await noToken.runAction("create-branch", {
          issueId: "i-1",
          values: {},
        })
      )?.message,
    ).toContain("Connect GitHub");

    const readOnly = host({
      settings: { repositories: "acme/web" },
      github: (req) =>
        req.method === "POST" ? { status: 403 } : fakeGitHub()(req),
    });
    await loadPlugin(GitHub, readOnly);
    expect(
      (
        await readOnly.runAction("create-branch", {
          issueId: "i-1",
          values: {},
        })
      )?.message,
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

describe("Run workflow (BARY-238)", () => {
  const branch = {
    kind: "branch",
    repo: "acme/web",
    name: "ada/nim-42-cookie",
    url: null,
    deleted: false,
    at: "2026-11-19T10:00:00Z",
  };

  it("starts the project's workflow on the issue's branch", async () => {
    const log: Net[] = [];
    const h = host({
      settings: { workflow: "deploy.yml" },
      entries: [branch],
      github: (req) => {
        log.push(req);
        return { status: 204 };
      },
    });
    await loadPlugin(GitHub, h);
    const result = await h.runAction("run-workflow", { issueId: "i-1" });
    expect(result).toMatchObject({ tone: "success" });
    expect(result.message).toContain("deploy.yml");
    expect(log[0]).toMatchObject({
      url: "https://api.github.com/repos/acme/web/actions/workflows/deploy.yml/dispatches",
      method: "POST",
    });
    expect(JSON.parse(log[0].body ?? "{}")).toEqual({
      ref: "ada/nim-42-cookie",
    });
  });

  it("says what's missing: a workflow, a branch, or what GitHub refused", async () => {
    const run = async (
      settings: Record<string, unknown>,
      entries: unknown[],
      status = 204,
    ) => {
      const h = host({ settings, entries, github: () => ({ status }) });
      await loadPlugin(GitHub, h);
      return (await h.runAction("run-workflow", { issueId: "i-1" })).message;
    };
    expect(await run({}, [branch])).toContain("workflow");
    expect(await run({ workflow: "ci.yml" }, [])).toContain("No branch");
    expect(await run({ workflow: "ci.yml" }, [branch], 422)).toContain(
      "workflow_dispatch",
    );
    expect(await run({ workflow: "ci.yml" }, [branch], 404)).toContain(
      "doesn't know",
    );
    expect(await run({ workflow: "ci.yml" }, [branch], 403)).toContain(
      "Actions: write",
    );
  });
});

describe("Rename and delete a branch", () => {
  it("renames it after asking the new name, and moves its entry", async () => {
    const log: Net[] = [];
    const h = host({
      github: (req) => {
        log.push(req);
        return req.url.endsWith("/branches/nim-42-old/rename")
          ? { status: 201, body: {} }
          : { status: 404 };
      },
    });
    await loadPlugin(GitHub, h);
    const asked = await h.runAction("rename-branch", {
      issueId: "i-1",
      choice: "acme/web:nim-42-old",
    });
    expect(asked.form?.fields[0]).toMatchObject({ value: "nim-42-old" });
    const done = await h.runAction("rename-branch", {
      issueId: "i-1",
      choice: "acme/web:nim-42-old",
      values: { name: "nim-42-new" },
    });
    expect(done).toMatchObject({ tone: "success", refresh: true });
    expect(JSON.parse(log.at(-1)?.body ?? "{}")).toEqual({
      new_name: "nim-42-new",
    });
    expect(h.calls.map((c) => c.method)).toContain("issueData.delete");
  });

  it("deletes it once confirmed, and its entry says so", async () => {
    const log: Net[] = [];
    const h = host({
      github: (req) => {
        log.push(req);
        return { status: 204 };
      },
    });
    await loadPlugin(GitHub, h);
    const asked = await h.runAction("delete-branch", {
      issueId: "i-1",
      choice: "acme/web:nim-42-old",
    });
    expect(asked.form).toMatchObject({ danger: true, fields: [] });
    expect(log).toHaveLength(0);
    await h.runAction("delete-branch", {
      issueId: "i-1",
      choice: "acme/web:nim-42-old",
      values: {},
    });
    expect(log[0]).toMatchObject({ method: "DELETE" });
    expect(log[0].url).toEndWith("/repos/acme/web/git/refs/heads/nim-42-old");
    const kept = h.calls.find((c) => c.method === "issueData.set");
    expect(kept?.params).toMatchObject({ value: { deleted: true } });
  });
});

describe("Create pull request (BARY-238)", () => {
  const branch = (name: string, h: number) => ({
    kind: "branch",
    repo: "acme/web",
    name,
    url: null,
    deleted: false,
    at: `2026-11-19T${String(h).padStart(2, "0")}:00:00Z`,
  });

  it("opens GitHub's page to create one for the issue's only branch", async () => {
    const h = host({ entries: [branch("nim-42-keep", 9)] });
    await loadPlugin(GitHub, h);
    const result = await h.runAction("create-pull-request", { issueId: "i-1" });
    expect(result.open).toBe(
      "https://github.com/acme/web/compare/nim-42-keep?expand=1&title=NIM-42%3A%20Keep%20the%20cookie",
    );
  });

  it("asks which branch with several, then opens it for that one", async () => {
    const h = host({
      entries: [branch("nim-42-a", 9), branch("nim-42-b", 10)],
    });
    await loadPlugin(GitHub, h);
    const asked = await h.runAction("create-pull-request", { issueId: "i-1" });
    expect(asked.pick?.options.map((o) => o.label)).toEqual([
      "nim-42-b",
      "nim-42-a",
    ]);
    const done = await h.runAction("create-pull-request", {
      issueId: "i-1",
      choice: "acme/web:nim-42-a",
    });
    expect(done.open).toContain("/compare/nim-42-a?");
  });

  it("says so without a branch", async () => {
    const h = host({});
    await loadPlugin(GitHub, h);
    expect(
      (await h.runAction("create-pull-request", { issueId: "i-1" })).tone,
    ).toBe("warning");
  });
});
