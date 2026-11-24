import { describe, expect, it } from "bun:test";
import { development, latestReviews } from "../src/development";

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
