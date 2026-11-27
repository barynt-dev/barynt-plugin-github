import { describe, expect, it } from "bun:test";
import { readInputs, type WorkflowRun } from "../src/github";
import { readConfig, writeConfig } from "../src/stages";
import { fillTemplate, latestRuns } from "../src/workflows";

// Workflows in the issue (BARY-238): what one takes when started by hand,
// which runs show, and inputs filled from the issue.

describe("a workflow's inputs", () => {
  it("reads them from workflow_dispatch, with types, defaults and options", () => {
    const inputs = readInputs(`
name: Seed
on:
  push:
  workflow_dispatch:
    inputs:
      environment:
        type: environment
        required: true
      scenario:
        type: choice
        options: [empty, checkout]
        default: checkout
      dry_run:
        type: boolean
        default: false
      note:
        description: What it's for
`);
    expect(inputs).toEqual([
      {
        name: "environment",
        type: "environment",
        description: null,
        required: true,
        default: null,
        options: [],
      },
      {
        name: "scenario",
        type: "choice",
        description: null,
        required: false,
        default: "checkout",
        options: ["empty", "checkout"],
      },
      {
        name: "dry_run",
        type: "boolean",
        description: null,
        required: false,
        default: false,
        options: [],
      },
      {
        name: "note",
        type: "string",
        description: "What it's for",
        required: false,
        default: null,
        options: [],
      },
    ]);
  });

  it("takes on: workflow_dispatch without inputs — and nothing without it", () => {
    expect(readInputs("on: workflow_dispatch\njobs: {}")).toEqual([]);
    expect(readInputs("on: [push, workflow_dispatch]")).toEqual([]);
    expect(readInputs("on: push")).toBeNull();
    expect(readInputs(": : not yaml [")).toBeNull();
  });
});

describe("the runs the issue shows", () => {
  const run = (
    id: number,
    file: string,
    conclusion: string | null,
    status = "completed",
  ): WorkflowRun => ({
    id,
    name: file.replace(".yml", ""),
    file,
    status,
    conclusion,
    event: "push",
    branch: "web-1",
    sha: "abc",
    actor: "ada",
    number: id,
    startedAt: null,
    updatedAt: `2026-11-27T10:00:${String(id).padStart(2, "0")}Z`,
    url: null,
    repo: "acme/web",
  });

  it("the newest per workflow, failed first, then running — not hidden or deployments", () => {
    const shown = latestRuns(
      [
        run(1, "ci.yml", "failure"),
        run(5, "ci.yml", "success"),
        run(2, "e2e.yml", "failure"),
        run(3, "lint.yml", null, "in_progress"),
        run(4, "beta.yml", "success"),
        run(6, "nightly.yml", "success"),
      ],
      [
        { workflow: "beta.yml", stage: "staging" },
        { workflow: "nightly.yml", show: false },
      ],
    );
    expect(shown.map((r) => [r.file, r.id])).toEqual([
      ["e2e.yml", 2],
      ["lint.yml", 3],
      ["ci.yml", 5],
    ]);
  });

  it("fills inputs from the issue", () => {
    expect(
      fillTemplate(
        "{key}: {title} on {branch} for {assignee}",
        { ref: "MOB-3", title: "Fix drag", assignee: { name: "Ada" } },
        "mob-3-fix",
      ),
    ).toBe("MOB-3: Fix drag on mob-3-fix for Ada");
  });

  it("keeps a workflow's settings — a deployment only with a stage", () => {
    const kept = writeConfig(
      readConfig({
        workflows: [
          {
            workflow: "seed.yml",
            start: true,
            startBy: "managers",
            prefill: { ticket: "{key}" },
          },
          { workflow: "beta.yml", stage: "staging" },
        ],
      }),
    );
    expect(kept.workflows).toEqual([
      {
        workflow: "seed.yml",
        start: true,
        startBy: "managers",
        prefill: { ticket: "{key}" },
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
