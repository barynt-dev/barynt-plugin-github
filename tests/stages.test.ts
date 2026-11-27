import { describe, expect, it } from "bun:test";
import { groupJobs, logLines } from "../src/deployments";
import type { Deployment } from "../src/entries";
import type { Job } from "../src/github";
import {
  matchPattern,
  OTHER,
  partsOf,
  place,
  readConfig,
  recognize,
  stations,
  worst,
  writeConfig,
} from "../src/stages";

// Stages of a deployment (BARY-238): recognized by name, set by hand, by
// a pattern, or a workflow's run — in the project's order.

const deploy = (
  environment: string,
  over: Partial<Deployment> = {},
): Deployment => ({
  kind: "deployment",
  repo: "acme/web",
  environment,
  production: false,
  state: "success",
  ref: "main",
  sha: "abc1234",
  url: null,
  at: "2026-11-20T10:00:00Z",
  ...over,
});

describe("recognizing an environment by its name", () => {
  it("finds the stage, and the service or region beside it", () => {
    expect(recognize("production", true)).toEqual({ stage: "production" });
    expect(recognize("api-staging", false)).toEqual({
      stage: "staging",
      service: "api",
    });
    expect(recognize("web/production", false)).toEqual({
      stage: "production",
      service: "web",
    });
    expect(recognize("prod-eu", false)).toEqual({
      stage: "production",
      region: "eu",
    });
    expect(recognize("pr-42", false)).toEqual({ stage: "preview" });
    expect(recognize("Preview – web-42", false)).toEqual({ stage: "preview" });
    expect(recognize("qa-blue", false)).toEqual({
      stage: "staging",
      service: "blue",
    });
    expect(recognize("github-pages", false)).toEqual({ stage: null });
    // GitHub's own mark counts when the name says nothing.
    expect(recognize("live-site", false).stage).toBe("production");
    expect(recognize("site", true).stage).toBe("production");
  });

  it("matches a pattern, * any text", () => {
    expect(matchPattern("pr-*", "pr-42")).toBe("42");
    expect(matchPattern("*-staging", "API-staging")).toBe("API");
    expect(matchPattern("pr-*", "preview")).toBeNull();
  });
});

describe("placing an environment", () => {
  const config = readConfig({
    envs: { "qa-blue": { stage: "test" }, "github-pages": { hidden: true } },
    patterns: [{ match: "*-canary", stage: "production", region: "canary" }],
    workflows: [
      { workflow: "beta.yml", stage: "staging", environment: "beta" },
    ],
  });

  it("by hand first, then a pattern, then by name — else Other", () => {
    expect(place(deploy("qa-blue"), config)).toMatchObject({
      stage: "test",
      by: "hand",
    });
    expect(place(deploy("web-canary"), config)).toMatchObject({
      stage: "production",
      region: "canary",
      by: "pattern",
    });
    expect(place(deploy("api-staging"), config)).toMatchObject({
      stage: "staging",
      service: "api",
      by: "auto",
    });
    expect(place(deploy("docs"), config)).toMatchObject({ stage: OTHER });
    expect(place(deploy("github-pages"), config).hidden).toBe(true);
  });

  it("puts a workflow's run where its workflow is set — gone, nowhere", () => {
    expect(
      place(deploy("beta", { workflowFile: "beta.yml" }), config),
    ).toMatchObject({ stage: "staging", by: "workflow" });
    expect(
      place(deploy("nightly", { workflowFile: "nightly.yml" }), config).hidden,
    ).toBe(true);
  });

  it("recognizes nothing once that's off", () => {
    const off = readConfig({ auto: false });
    expect(place(deploy("staging"), off).stage).toBe(OTHER);
  });

  it("tells each workflow the environment it counts as, and if it's live", () => {
    const kept = writeConfig(
      readConfig({
        workflows: [
          { workflow: "release.yml", stage: "production", environment: "x" },
          { workflow: "beta.yml", stage: "staging", environment: "x" },
        ],
      }),
    );
    expect(kept.workflows).toEqual([
      {
        workflow: "release.yml",
        stage: "production",
        environment: "release",
        production: true,
      },
      {
        workflow: "beta.yml",
        stage: "staging",
        environment: "beta",
        production: false,
      },
    ]);
  });
});

describe("the stops of the line", () => {
  it("only stages it reached — and ones the repository deploys to", () => {
    const config = readConfig(undefined);
    const list = stations(
      [deploy("staging"), deploy("pr-41"), deploy("pr-42")],
      config,
      [{ environment: "production", production: true }],
    );
    expect(list.map((s) => [s.stage.id, s.reached])).toEqual([
      ["preview", true],
      ["staging", true],
      ["production", false],
    ]);
    // Previews are each their own part.
    expect(partsOf(list[0])).toHaveLength(2);
  });

  it("follows the project's own stages and their order", () => {
    const config = readConfig({
      stages: [
        { id: "beta", name: "Beta" },
        { id: "release", name: "Release", live: true },
      ],
      workflows: [
        { workflow: "beta.yml", stage: "beta", environment: "beta" },
        { workflow: "release.yml", stage: "release", environment: "release" },
      ],
    });
    const list = stations(
      [deploy("beta", { workflowFile: "beta.yml" })],
      config,
    );
    expect(list.map((s) => s.stage.name)).toEqual(["Beta"]);
  });

  it("takes the worst state of a stop's parts", () => {
    expect(worst(["success", "failure", "running"])).toBe("failure");
    expect(worst(["success", "waiting"])).toBe("waiting");
    expect(worst(["success", "pending"])).toBe("running");
    expect(worst(["inactive", "cancelled"])).toBe("idle");
  });

  it("gives each region its own part", () => {
    const list = stations(
      [
        deploy("prod-eu", { state: "success" }),
        deploy("prod-us", { state: "running" }),
        deploy("prod-ap", { state: "success" }),
      ],
      readConfig(undefined),
    );
    expect(
      partsOf(list[0])
        .map((p) => p.placed.region)
        .sort(),
    ).toEqual(["ap", "eu", "us"]);
  });
});

describe("a run's jobs and logs", () => {
  const job = (name: string): Job => ({
    id: name.length,
    name,
    status: "completed",
    conclusion: "success",
    url: null,
    startedAt: null,
    completedAt: null,
    steps: [],
  });

  it("groups a reusable workflow's and a matrix's jobs", () => {
    expect(
      groupJobs([
        job("build"),
        job("e2e (chrome)"),
        job("e2e (firefox)"),
        job("deploy / migrate"),
        job("deploy / rollout"),
      ]).map((g) => [g.name, g.jobs.length]),
    ).toEqual([
      ["build", 1],
      ["e2e", 2],
      ["deploy", 2],
    ]);
  });

  it("reads GitHub's log: no times, groups as headings, errors marked", () => {
    expect(
      logLines(
        [
          "2026-11-27T10:00:00.1234567Z ##[group]Run bun test",
          "2026-11-27T10:00:01.0000000Z \u001b[36;1mbun test v1.3\u001b[0m",
          "2026-11-27T10:00:01.0000000Z ##[endgroup]",
          "2026-11-27T10:00:02.0000000Z ##[error]Process completed with exit code 1.",
          "2026-11-27T10:00:02.0000000Z [command]/usr/bin/git version",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { text: "Run bun test", heading: true },
      { text: "bun test v1.3" },
      { text: "Process completed with exit code 1.", tone: "danger" },
      { text: "/usr/bin/git version", tone: "muted" },
    ]);
  });
});
