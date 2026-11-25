import { describe, expect, it } from "bun:test";
import {
  development,
  lastComment,
  latestReviews,
  prProgress,
  reviewer,
  withoutIssueKey,
} from "../src/development";
import type { PullRequest } from "../src/entries";

// What the "Development" panel shows (BARY-229), from Barynt's entries.

const entry = (value: Record<string, unknown>) => ({ key: "k", value });
const at = (h: number) => `2026-11-19T${String(h).padStart(2, "0")}:00:00Z`;

describe("development()", () => {
  it("gathers branches still there, pull requests with their checks, and commits", () => {
    const dev = development([
      entry({
        kind: "branch",
        repo: "acme/web",
        name: "ada/web-42",
        url: "https://github.com/acme/web/tree/ada/web-42",
        deleted: false,
        at: at(9),
      }),
      entry({
        kind: "branch",
        repo: "acme/web",
        name: "old",
        url: null,
        deleted: true,
        at: at(8),
      }),
      entry({
        kind: "pull_request",
        repo: "acme/web",
        number: 42,
        title: "T",
        state: "open",
        review: null,
        url: null,
        branch: "ada/web-42",
        base: "main",
        author: "ada",
        additions: 1,
        deletions: 2,
        at: at(10),
      }),
      entry({
        kind: "checks",
        repo: "acme/web",
        branch: "ada/web-42",
        sha: "s",
        state: "failure",
        runs: [
          { name: "build", state: "success", url: null },
          { name: "test", state: "failure", url: null },
        ],
        at: at(11),
      }),
      entry({
        kind: "commit",
        repo: "acme/web",
        sha: "9f3a1c2d4e5f6071",
        message: "Keep cookie",
        url: null,
        author: "ada",
        branch: "ada/web-42",
        at: at(9),
      }),
    ]);
    expect(dev.branches.map((b) => b.name)).toEqual(["ada/web-42"]);
    expect(dev.pullRequests[0].steps).toEqual([
      { label: "build", state: "success" },
      { label: "test", state: "danger" },
    ]);
    expect(dev.commits).toEqual([
      {
        sha: "9f3a1c2",
        message: "Keep cookie",
        url: null,
        author: "ada",
        at: at(9),
      },
    ]);
  });
});

describe("latestReviews()", () => {
  it("keeps each person's latest review that decides", () => {
    expect(
      latestReviews([
        { user: { login: "tom" }, state: "CHANGES_REQUESTED" },
        { user: { login: "ada" }, state: "COMMENTED" },
        { user: { login: "tom" }, state: "APPROVED" },
        { user: { login: "eve" }, state: "APPROVED" },
        { user: { login: "eve" }, state: "DISMISSED" },
      ]),
    ).toEqual([{ login: "tom", state: "approved" }]);
  });

  it("finds the newest comment, and how many there are", () => {
    expect(
      lastComment([
        {
          user: { login: "tom" },
          state: "CHANGES_REQUESTED",
          body: "Fix the test",
        },
        { user: { login: "ada" }, state: "COMMENTED", body: "  And the docs " },
        { user: { login: "tom" }, state: "APPROVED", body: "" },
        { user: { login: "eve" }, state: "DISMISSED", body: "Never mind" },
      ]),
    ).toEqual({ login: "ada", text: "And the docs", count: 2 });
    expect(
      lastComment([{ user: { login: "tom" }, state: "APPROVED" }]),
    ).toBeNull();
  });

  it("names bots short — Barynt's app as Barynt-App", () => {
    expect(reviewer("barynt-opposite-fancy-hotel-infect[bot]")).toEqual({
      name: "Barynt-App",
      bot: true,
    });
    expect(reviewer("dependabot[bot]")).toEqual({
      name: "dependabot",
      bot: true,
    });
    expect(reviewer("ada")).toEqual({ name: "ada", bot: false });
  });
});

describe("deployments (BARY-238)", () => {
  it("lists where it went, production first", () => {
    const deploy = (environment: string, production: boolean, at: string) => ({
      key: `deploy:${environment}`,
      value: {
        kind: "deployment",
        repo: "acme/web",
        environment,
        production,
        state: "success",
        ref: "main",
        sha: "abc",
        url: null,
        at,
      },
    });
    const dev = development([
      deploy("staging", false, "2026-11-20T10:00:00Z"),
      deploy("production", true, "2026-11-19T10:00:00Z"),
    ]);
    expect(dev.deployments.map((d) => d.environment)).toEqual([
      "production",
      "staging",
    ]);
  });
});

describe("several branches (BARY-238)", () => {
  const branch = (name: string, h: number, deleted = false) =>
    entry({
      kind: "branch",
      repo: "acme/web",
      name,
      url: null,
      deleted,
      at: at(h),
    });
  const pr = (branchName: string, state: string, h: number) =>
    entry({
      kind: "pull_request",
      repo: "acme/web",
      number: h,
      title: "x",
      state,
      review: null,
      url: null,
      branch: branchName,
      base: "main",
      author: null,
      additions: null,
      deletions: null,
      at: at(h),
    });

  it("puts the one with an open pull request on top, before a newer one", () => {
    const { branchView } = development([
      branch("web-42-spike", 12),
      branch("web-42-fix", 10),
      pr("web-42-fix", "open", 11),
    ]);
    expect(branchView.main?.name).toBe("web-42-fix");
    expect(branchView.main?.pr?.number).toBe(11);
    expect(branchView.others.map((b) => b.name)).toEqual(["web-42-spike"]);
  });

  it("without one, the newest; deleted and merged ones are done", () => {
    const { branchView } = development([
      branch("web-42-new", 12),
      branch("web-42-merged", 11),
      pr("web-42-merged", "merged", 11),
      branch("web-42-gone", 9, true),
    ]);
    expect(branchView.main?.name).toBe("web-42-new");
    expect(branchView.others).toEqual([]);
    expect(branchView.done.map((b) => b.name)).toEqual([
      "web-42-merged",
      "web-42-gone",
    ]);
  });
});

describe("a pull request's way to the merge", () => {
  const pr = (over: Partial<PullRequest>): PullRequest => ({
    kind: "pull_request",
    repo: "acme/web",
    number: 5,
    title: "MOB-2: Fix it",
    state: "open",
    review: null,
    url: "https://github.com/acme/web/pull/5",
    branch: "mob-2",
    base: "main",
    author: "ada",
    additions: 1,
    deletions: 0,
    at: "2026-11-25T10:00:00Z",
    ...over,
  });
  const states = (p: ReturnType<typeof prProgress>) =>
    p.stages.map((s) => s.state);

  it("names failed checks first, then a review that wants changes", () => {
    const failing = prProgress(pr({ review: "changes_requested" }), [
      { state: "danger" },
      { state: "danger" },
      { state: "success" },
    ]);
    expect(failing.next).toEqual({ kind: "checksFailed", count: 2 });
    expect(states(failing)).toEqual(["success", "danger", "danger", "pending"]);
    expect(prProgress(pr({ review: "changes_requested" }), []).next.kind).toBe(
      "changesRequested",
    );
  });

  it("waits on a draft, running checks, a review — then it's ready", () => {
    expect(prProgress(pr({ state: "draft" }), []).next.kind).toBe("draft");
    expect(prProgress(pr({}), [{ state: "running" }]).next.kind).toBe(
      "checksRunning",
    );
    expect(prProgress(pr({}), []).next.kind).toBe("awaitingReview");
    const ready = prProgress(pr({ review: "approved" }), [
      { state: "success" },
    ]);
    expect(ready.next.kind).toBe("readyToMerge");
    expect(states(ready)).toEqual(["success", "success", "success", "warning"]);
  });

  it("drops the issue's key from a title", () => {
    expect(withoutIssueKey("MOB-2: Fix it")).toBe("Fix it");
    expect(withoutIssueKey("[BARY-238] Fix it")).toBe("Fix it");
    expect(withoutIssueKey("Fix MOB-2")).toBe("Fix MOB-2");
    expect(withoutIssueKey("MOB-2")).toBe("MOB-2");
  });
});
