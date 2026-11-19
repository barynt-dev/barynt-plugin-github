// What Barynt keeps on an issue for this plugin, read from GitHub's
// webhooks (`handle: "link"`): one entry per pull request, branch, commit
// and checks. The shapes are Barynt's — see its docs/dev/plugins-manifest.md,
// "handle: link". Read with `api.issueData.list`.

export interface PullRequest {
  kind: "pull_request";
  repo: string;
  number: number;
  title: string;
  state: "draft" | "open" | "merged" | "closed";
  review: "approved" | "changes_requested" | null;
  url: string | null;
  branch: string | null;
  base: string | null;
  author: string | null;
  additions: number | null;
  deletions: number | null;
  at: string;
}

export interface Branch {
  kind: "branch";
  repo: string;
  name: string;
  url: string | null;
  deleted: boolean;
  at: string;
}

export interface Commit {
  kind: "commit";
  repo: string;
  sha: string;
  message: string;
  url: string | null;
  author: string | null;
  branch: string | null;
  at: string;
}

export type CheckState = "pending" | "success" | "failure" | "neutral";

export interface Checks {
  kind: "checks";
  repo: string;
  branch: string;
  sha: string;
  state: CheckState;
  runs: { name: string; state: CheckState; url: string | null }[];
  at: string;
}

export type Entry = PullRequest | Branch | Commit | Checks;

/** An issue's entries, by kind — anything Barynt doesn't send is left out. */
export function sortEntries(raw: { key: string; value: unknown }[]) {
  const all = raw
    .map((e) => e.value as Entry)
    .filter((v) => v && typeof v === "object" && "kind" in v);
  const newest = <T extends Entry>(list: T[]) =>
    [...list].sort((a, b) => b.at.localeCompare(a.at));
  return {
    pullRequests: newest(
      all.filter((e): e is PullRequest => e.kind === "pull_request"),
    ),
    branches: newest(all.filter((e): e is Branch => e.kind === "branch")),
    commits: newest(all.filter((e): e is Commit => e.kind === "commit")),
    checks: newest(all.filter((e): e is Checks => e.kind === "checks")),
  };
}
