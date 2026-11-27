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
  /** Where it was deployed, in the order a change goes through — a
   *  preview first, production last. */
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
    deployments: inOrder(deployments),
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

/** The newest thing written in a pull request's reviews — who and what —
 *  and how many there are in all (GitHub lists them oldest first). */
export function lastComment(
  reviews: {
    user?: { login?: string } | null;
    state?: string;
    body?: string | null;
  }[],
): { login: string; text: string; count: number } | null {
  const said = reviews.flatMap((r) => {
    const text = r.body?.trim();
    const login = r.user?.login;
    return text && login && r.state?.toLowerCase() !== "dismissed"
      ? [{ login, text }]
      : [];
  });
  const last = said.at(-1);
  return last ? { ...last, count: said.length } : null;
}

/** How a GitHub account reads in the panel: a bot without "[bot]" but
 *  with a tag — Barynt's own GitHub App as "Barynt-App". */
export function reviewer(login: string): { name: string; bot: boolean } {
  const bot = login.endsWith("[bot]");
  if (!bot) return { name: login, bot };
  const name = login.slice(0, -"[bot]".length);
  return { name: /^barynt([-_]|$)/i.test(name) ? "Barynt-App" : name, bot };
}

/** A station on a pull request's way to merging. */
export type Stage = "ready" | "checks" | "review" | "merge";

/** What stands between an open pull request and its merge — the first
 *  that holds it up, or that it's ready. */
export type NextStep =
  | { kind: "checksFailed"; count: number }
  | { kind: "changesRequested" }
  | { kind: "draft" }
  | { kind: "checksRunning" }
  | { kind: "awaitingReview" }
  | { kind: "readyToMerge" };

/**
 * Where an open pull request stands — ready (not a draft), its checks, its
 * review, the merge — and the next thing to do about it. A pull request
 * without checks isn't held up by them.
 */
export function prProgress(
  pr: PullRequest,
  steps: { state: StepState }[],
): { stages: { stage: Stage; state: StepState }[]; next: NextStep } {
  const failed = steps.filter((s) => s.state === "danger").length;
  const running = steps.some(
    (s) => s.state === "running" || s.state === "warning",
  );
  const checks: StepState =
    steps.length === 0
      ? "pending"
      : failed > 0
        ? "danger"
        : running
          ? "running"
          : "success";
  const review: StepState =
    pr.review === "changes_requested"
      ? "danger"
      : pr.review === "approved"
        ? "success"
        : "pending";
  const draft = pr.state === "draft";
  const next: NextStep =
    failed > 0
      ? { kind: "checksFailed", count: failed }
      : pr.review === "changes_requested"
        ? { kind: "changesRequested" }
        : draft
          ? { kind: "draft" }
          : running
            ? { kind: "checksRunning" }
            : pr.review !== "approved"
              ? { kind: "awaitingReview" }
              : { kind: "readyToMerge" };
  return {
    stages: [
      { stage: "ready", state: draft ? "warning" : "success" },
      { stage: "checks", state: checks },
      { stage: "review", state: review },
      {
        stage: "merge",
        state: next.kind === "readyToMerge" ? "warning" : "pending",
      },
    ],
    next,
  };
}

/** A pull request's title without the issue's key in front — "MOB-2: Fix
 *  it" in MOB-2 is "Fix it". */
export function withoutIssueKey(title: string): string {
  const rest = title.replace(/^\s*\[?[A-Z][A-Z0-9_]*-\d+\]?\s*[:\-–—]?\s*/, "");
  return rest.length > 0 ? rest : title;
}

/** Where an environment stands on the way to production: a preview first,
 *  then tests, then staging, production last — by its name, GitHub has no
 *  order. */
export function stationRank(d: {
  environment: string;
  production: boolean;
}): number {
  const name = d.environment.toLowerCase();
  if (d.production || /\bprod(uction)?\b|^live$/.test(name)) return 4;
  if (/stag|uat|\bqa\b|pre-?prod|accept/.test(name)) return 3;
  if (/test|integration|\bci\b/.test(name)) return 2;
  if (/preview|review|\bdev|feature|\bpr\b|pr-\d/.test(name)) return 1;
  return 2;
}

/** Environments in the order a change goes through; one repository's
 *  together, then by name. */
export function inOrder<
  T extends { environment: string; production: boolean; repo: string },
>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      stationRank(a) - stationRank(b) ||
      a.environment.localeCompare(b.environment) ||
      a.repo.localeCompare(b.repo),
  );
}

/** An environment further along running an older version than one
 *  before it — production behind staging, say — and by how many commits,
 *  when the issue's commits tell. The one furthest along first. */
export function lagging(
  deployments: Deployment[],
  commits: { sha: string }[],
): { behind: Deployment; ahead: Deployment; commits: number | null } | null {
  const live = inOrder(deployments).filter(
    (d) => d.state === "success" && d.sha,
  );
  for (let j = live.length - 1; j > 0; j--)
    for (let i = j - 1; i >= 0; i--) {
      const [ahead, behind] = [live[i], live[j]];
      if (ahead.repo !== behind.repo || ahead.sha === behind.sha) continue;
      if (stationRank(ahead) === stationRank(behind)) continue;
      if (ahead.at <= behind.at) continue;
      const at = (sha: string | null) =>
        commits.findIndex((c) => sha && c.sha.startsWith(sha.slice(0, 7)));
      const a = at(ahead.sha);
      const b = at(behind.sha);
      return { behind, ahead, commits: a >= 0 && b > a ? b - a : null };
    }
  return null;
}
