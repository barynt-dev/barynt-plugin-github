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
  it("draws signals, not sentences: number, checks as passed/all, the review", () => {
    const row = pullRequestRow(entries(pr(), checks()));
    expect(row).toMatchObject({
      badge: "pull-request",
      kind: "row",
      text: "#42 Open",
      tooltip: "acme/web#42: Keep the session cookie",
    });
    expect(row?.parts).toEqual([
      { type: "icon", icon: "git-pull-request", tone: "success" },
      { type: "text", text: "#42", size: "xs", mono: true, tone: "subtle" },
      { type: "icon", icon: "timer", tone: "info" },
      {
        type: "text",
        text: "2/3",
        size: "xs",
        mono: true,
        tone: "info",
        strong: true,
      },
      { type: "icon", icon: "eye", tone: "neutral" },
      { type: "text", text: "Review", tone: "subtle", size: "xs" },
      { type: "spacer" },
    ]);
    const changes = pullRequestRow(
      entries(
        pr({ review: "changes_requested" }),
        checks({ state: "failure" }),
      ),
    );
    expect(changes?.parts).toContainEqual({
      type: "text",
      text: "Changes",
      tone: "warning",
      size: "xs",
      strong: true,
    });
    expect(changes?.parts).toContainEqual({
      type: "icon",
      icon: "circle-x",
      tone: "danger",
    });
  });

  it("leaves other branches' checks, and checks once it's merged", () => {
    const other = checks({ branch: "main", state: "failure" });
    expect(pullRequestRow(entries(pr(), other))?.parts).not.toContainEqual(
      expect.objectContaining({ mono: true, tone: "danger" }),
    );
    const merged = pullRequestRow(entries(pr({ state: "merged" }), checks()));
    expect(merged?.parts).toContainEqual({
      type: "text",
      text: "Merged",
      tone: "primary",
      strong: true,
    });
    expect(merged?.parts).not.toContainEqual(
      expect.objectContaining({ type: "icon", icon: "timer" }),
    );
  });

  it("counts the other pull requests still open — not the done ones", () => {
    const row = pullRequestRow(
      entries(
        pr(),
        pr({ number: 7, state: "merged", at: "2026-11-18T10:00:00Z" }),
        pr({ number: 8, state: "draft", at: "2026-11-17T10:00:00Z" }),
      ),
    );
    expect(row?.parts?.at(-1)).toMatchObject({
      type: "group",
      children: [
        { type: "icon", icon: "git-pull-request" },
        { type: "text", text: "+1" },
      ],
    });
  });

  it("draws nothing without a pull request", () => {
    expect(pullRequestRow(entries(checks()))).toBeNull();
    expect(pullRequestRow([])).toBeNull();
  });
});
