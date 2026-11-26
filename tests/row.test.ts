import { describe, expect, it } from "bun:test";
import type { Checks, PullRequest } from "../src/entries";
import { prLook, pullRequestRow, shownPullRequest } from "../src/row";

// The pull request's row on a card (BARY-228), from the entries Barynt
// keeps on an issue.

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
  kind: "pull_request",
  repo: "acme/web",
  number: 42,
  title: "Keep the session cookie",
  state: "open",
  review: null,
  url: "https://github.com/acme/web/pull/42",
  branch: "ada/web-42-cookie",
  base: "main",
  author: "ada",
  additions: 120,
  deletions: 34,
  at: "2026-11-19T10:00:00Z",
  ...over,
});
const checks = (over: Partial<Checks> = {}): Checks => ({
  kind: "checks",
  repo: "acme/web",
  branch: "ada/web-42-cookie",
  sha: "abc",
  state: "pending",
  runs: [
    { name: "build", state: "success", url: null },
    { name: "test", state: "success", url: null },
    { name: "e2e", state: "pending", url: null },
  ],
  at: "2026-11-19T10:01:00Z",
  ...over,
});
const entries = (...values: unknown[]) =>
  values.map((value, i) => ({ key: `k${i}`, value }));

describe("how a pull request reads", () => {
  it("lets a review that decides win over open", () => {
    expect(prLook(pr()).text).toBe("Open");
    expect(prLook(pr({ review: "changes_requested" }))).toMatchObject({
      text: "Changes requested",
      tone: "warning",
    });
    expect(prLook(pr({ review: "approved" })).text).toBe("Approved");
    expect(prLook(pr({ state: "draft" })).text).toBe("Draft");
    expect(prLook(pr({ state: "merged", review: "approved" }))).toMatchObject({
      text: "Merged",
      icon: "git-merge",
    });
    expect(prLook(pr({ state: "closed" })).tone).toBe("danger");
  });

  it("shows the newest open one, else the newest merged", () => {
    const merged = pr({
      number: 1,
      state: "merged",
      at: "2026-11-19T12:00:00Z",
    });
    const open = pr({ number: 2, at: "2026-11-19T09:00:00Z" });
    expect(shownPullRequest([merged, open])?.number).toBe(2);
    expect(
      shownPullRequest([merged, pr({ number: 3, state: "closed" })])?.number,
    ).toBe(1);
    expect(shownPullRequest([])).toBeNull();
  });
});

describe("the row", () => {
  it("draws number, a divider, the review — and on the right the checks", () => {
    const row = pullRequestRow(entries(pr(), checks()));
    expect(row).toMatchObject({
      badge: "pull-request",
      kind: "row",
      text: "#42 Open",
      tooltip: "acme/web#42: Keep the session cookie",
    });
    expect(row?.parts).toEqual([
      {
        type: "group",
        gap: 1,
        align: "center",
        children: [
          { type: "icon", icon: "git-pull-request", tone: "success" },
          { type: "text", text: "#42", size: "xs", mono: true, tone: "subtle" },
        ],
      },
      { type: "divider" },
      { type: "icon", icon: "eye", tone: "neutral" },
      { type: "text", text: "Review", tone: "subtle", size: "xs" },
      { type: "spacer" },
      // Running: how many of all are done.
      {
        type: "group",
        gap: 1,
        align: "center",
        children: [
          { type: "icon", icon: "timer", tone: "info" },
          {
            type: "text",
            text: "2/3",
            size: "xs",
            mono: true,
            tone: "info",
            strong: true,
          },
        ],
      },
    ]);
    // Failed: how many of all failed.
    const failed = pullRequestRow(
      entries(
        pr({ review: "changes_requested" }),
        checks({
          state: "failure",
          runs: [
            { name: "build", state: "failure", url: null },
            { name: "test", state: "success", url: null },
          ],
        }),
      ),
    );
    expect(failed?.parts?.at(-1)).toMatchObject({
      children: [
        { icon: "circle-x", tone: "danger" },
        { text: "1/2", tone: "danger" },
      ],
    });
    expect(failed?.parts).toContainEqual({
      type: "text",
      text: "Changes",
      tone: "warning",
      size: "xs",
      strong: true,
    });
  });

  it("leaves other branches' checks, and checks once it's merged", () => {
    // Nothing after the spacer: no checks on the right.
    const other = checks({ branch: "main", state: "failure" });
    expect(pullRequestRow(entries(pr(), other))?.parts?.at(-1)).toEqual({
      type: "spacer",
    });
    const merged = pullRequestRow(entries(pr({ state: "merged" }), checks()));
    expect(merged?.parts).toContainEqual({
      type: "text",
      text: "Merged",
      tone: "primary",
      size: "xs",
      strong: true,
    });
    expect(merged?.parts?.at(-1)).toEqual({ type: "spacer" });
  });

  it("draws nothing without a pull request", () => {
    expect(pullRequestRow(entries(checks()))).toBeNull();
    expect(pullRequestRow([])).toBeNull();
  });
});
