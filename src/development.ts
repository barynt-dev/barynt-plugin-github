import type { StepState } from "@barynt/plugin-sdk/ui";
import type { CheckState, Checks, Deployment, PullRequest } from "./entries";
import { sortEntries } from "./entries";

// What the "Development" panel shows for an issue (BARY-229), worked out
// from Barynt's entries — no DOM, so tests read it directly.

/** Commits shown before "Show all". */
export const COMMITS_SHOWN = 5;

const STEP: Record<CheckState, StepState> = {
  success: "success",
  failure: "danger",
  pending: "running",
  neutral: "pending",
};

/** A branch as the panel shows it, with its pull request and checks. */
export interface BranchRow {
  name: string;
  url: string | null;
  repo: string;
  deleted: boolean;
  /** Its newest pull request. */
  pr: PullRequest | null;
  checks: CheckState | null;
}

export interface Development {
  /** Branches still there, newest first. */
  branches: { name: string; url: string | null; repo: string }[];
  /** The issue's branches as the panel lays them out: the one that
   *  matters most on top — with an open pull request, else the newest —
   *  the others still being worked on folded below it, and the done ones
   *  (deleted, or merged) apart. */
  branchView: {
    main: BranchRow | null;
    others: BranchRow[];
    done: BranchRow[];
  };
  pullRequests: {
    pr: PullRequest;
    steps: { label: string; state: StepState }[];
  }[];
  commits: {
    sha: string;
    message: string;
    url: string | null;
    author: string | null;
    at: string;
  }[];
  /** Where it was deployed, production first, then newest. */
  deployments: Deployment[];
}

export function development(
  raw: { key: string; value: unknown }[],
): Development {
  const { pullRequests, branches, commits, checks, deployments } =
    sortEntries(raw);
  const checksOf = (pr: PullRequest): Checks | undefined =>
    checks.find((c) => c.repo === pr.repo && c.branch === pr.branch);
  const rows: BranchRow[] = branches.map((b) => ({
    name: b.name,
    url: b.url,
    repo: b.repo,
    deleted: b.deleted,
    pr:
      pullRequests.find((p) => p.repo === b.repo && p.branch === b.name) ??
      null,
    checks:
      checks.find((c) => c.repo === b.repo && c.branch === b.name)?.state ??
      null,
  }));
  const isOpen = (r: BranchRow) =>
    r.pr?.state === "open" || r.pr?.state === "draft";
  const done = rows.filter(
    (r) => r.deleted || (r.pr?.state === "merged" && !isOpen(r)),
  );
  const active = rows.filter((r) => !done.includes(r));
  const main = active.find(isOpen) ?? active[0] ?? null;
  return {
    branchView: {
      main,
      others: active.filter((r) => r !== main),
      done,
    },
    branches: branches
      .filter((b) => !b.deleted)
      .map((b) => ({ name: b.name, url: b.url, repo: b.repo })),
    pullRequests: pullRequests.map((pr) => ({
      pr,
      steps: (checksOf(pr)?.runs ?? []).map((r) => ({
        label: r.name,
        state: STEP[r.state],
      })),
    })),
    commits: commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.message,
      url: c.url,
      author: c.author,
      at: c.at,
    })),
    deployments: [...deployments].sort(
      (a, b) => Number(b.production) - Number(a.production),
    ),
  };
}

/** A pull request's reviews as GitHub lists them, each person's latest
 *  that counts (approved, changes requested). */
export function latestReviews(
  reviews: { user?: { login?: string } | null; state?: string }[],
): { login: string; state: "approved" | "changes_requested" }[] {
  const byUser = new Map<string, "approved" | "changes_requested">();
  for (const r of reviews) {
    const login = r.user?.login;
    const state = r.state?.toLowerCase();
    if (!login) continue;
    if (state === "approved" || state === "changes_requested")
      byUser.set(login, state);
    // A dismissed review takes back what that person said.
    if (state === "dismissed") byUser.delete(login);
  }
  return [...byUser].map(([login, state]) => ({ login, state }));
}
