import { BaryntError, type Plugin } from "@barynt/plugin-sdk";
import { branchName, DEFAULT_PATTERN, parseRepositories } from "./branch";
import { t } from "./i18n";

// Creating a branch on GitHub for an issue (BARY-230): with the person's
// own token when they keep one, else through the project's GitHub
// connection (BARY-238) — `net.fetch` adds either for api.github.com.

type Api = Plugin["api"];

const GITHUB = "https://api.github.com";
const JSON_HEADERS = {
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

/** What went wrong, said so a person can act on it. */
export class BranchError extends Error {}

async function github<T>(
  api: Api,
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<{ status: number; data: T | null }> {
  const res = await api.net.fetch(`${GITHUB}${path}`, {
    method: init.method ?? "GET",
    headers: JSON_HEADERS,
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  let data: T | null = null;
  try {
    data = res.text ? res.json<T>() : null;
  } catch {}
  return { status: res.status, data };
}

/** The project's settings for branches, defaults filled in. */
export async function branchSettings(api: Api) {
  const s = await api.settings.get();
  return {
    repositories: parseRepositories(s.repositories),
    pattern:
      typeof s.branchPattern === "string" && s.branchPattern.trim()
        ? s.branchPattern
        : DEFAULT_PATTERN,
    assign: s.branchAssign !== false,
    status: typeof s.branchStatus === "string" ? s.branchStatus : null,
    /** The workflow "Run workflow" starts — a file in .github/workflows. */
    workflow:
      typeof s.workflow === "string" && s.workflow.trim()
        ? s.workflow.trim()
        : null,
  };
}

/** The name a branch for this issue gets — with the person's login when
 *  their token is there, else without it. */
export async function proposedName(
  api: Api,
  issueId: string,
  pattern: string,
): Promise<string> {
  const issue = await api.issues.get(issueId);
  let user = "";
  try {
    const me = await github<{ login?: string }>(api, "/user");
    user = me.data?.login ?? "";
  } catch {}
  return branchName(pattern, {
    user,
    key: issue.ref,
    title: issue.title,
    type: issue.type,
  });
}

/**
 * Creates the issue's branch in one of the project's repositories — `repo`,
 * else its first — from its default branch — under the next free name if it's taken (`-2` … `-5`).
 * Then, as the project set it, assigns the issue to the person and sets
 * its status. Throws a `BranchError` that says what to do.
 */
export async function createBranch(
  api: Api,
  issueId: string,
  pick?: string,
  /** What the person set in the window: its name, and the branch it
   *  starts from — else the proposed name, from the default branch. */
  chosen: { name?: string; base?: string } = {},
): Promise<{ repo: string; name: string }> {
  const settings = await branchSettings(api);
  // Only one the project works with — never anything else.
  const repo =
    pick && settings.repositories.includes(pick)
      ? pick
      : settings.repositories[0];
  if (!repo) throw new BranchError(t("pickRepository"));
  const name =
    chosen.name?.trim() || (await proposedName(api, issueId, settings.pattern));
  if (!validBranchName(name)) throw new BranchError(t("badBranchName"));
  const info = await github<{ default_branch?: string }>(api, `/repos/${repo}`);
  if (info.status === 404) throw new BranchError(t("repoNotShown", { repo }));
  if (info.status === 401) throw new BranchError(t("tokenRefused"));
  const base = chosen.base?.trim() || info.data?.default_branch;
  if (!base)
    throw new BranchError(t("answeredFor", { status: info.status, repo }));
  const head = await github<{ object?: { sha?: string } }>(
    api,
    `/repos/${repo}/git/ref/heads/${base.split("/").map(encodeURIComponent).join("/")}`,
  );
  const sha = head.data?.object?.sha;
  if (!sha) throw new BranchError(t("noBase", { repo, base }));

  for (let n = 1; n <= 5; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    const made = await github(api, `/repos/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${candidate}`, sha },
    });
    if (made.status === 201) {
      // GitHub doesn't tell the app what it did itself: kept here.
      await recordBranch(api, issueId, repo, candidate, false);
      if (settings.assign || settings.status)
        await api.issues.update(issueId, {
          ...(settings.assign && { assignee: "me" }),
          ...(settings.status && { status: settings.status }),
        });
      return { repo, name: candidate };
    }
    // Taken: try the next name. Anything else is an answer to pass on.
    if (made.status !== 422)
      throw new BranchError(
        made.status === 403 || made.status === 404
          ? t("noWriteRight", { repo })
          : t("answered", { status: made.status }),
      );
  }
  throw new BranchError(t("namesTaken", { name, repo }));
}

/**
 * Starts the project's workflow on a branch (`workflow_dispatch`), with the
 * person's token or the connection's app (Actions: write). Throws a
 * `BranchError` that says what to do.
 */
export async function runWorkflow(
  api: Api,
  repo: string,
  branch: string,
  workflow: string,
): Promise<void> {
  const res = await github(
    api,
    `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    { method: "POST", body: { ref: branch } },
  );
  if (res.status === 204) return;
  throw new BranchError(
    res.status === 404
      ? t("workflowNotFound", { workflow, repo })
      : res.status === 422
        ? t("workflowNoDispatch", { workflow })
        : res.status === 403
          ? t("workflowNoRight")
          : t("answered", { status: res.status }),
  );
}

/**
 * Runs a deployment's workflow run again — every job, as GitHub's "Re-run
 * all jobs" — with the person's token or the connection's app (Actions:
 * write). Throws a `BranchError` that says what to do.
 */
export async function rerunWorkflow(
  api: Api,
  repo: string,
  runId: number,
): Promise<void> {
  const res = await github<{ message?: string }>(
    api,
    `/repos/${repo}/actions/runs/${runId}/rerun`,
    { method: "POST" },
  );
  if (res.status === 201) return;
  throw new BranchError(
    res.status === 403
      ? /month|too old/i.test(res.data?.message ?? "")
        ? t("rerunTooOld")
        : t("workflowNoRight")
      : res.status === 404
        ? t("rerunGone")
        : t("answered", { status: res.status }),
  );
}

/** The environments a repository has deployed to lately — production and
 *  staging, say, that an issue hasn't reached yet. Empty when GitHub
 *  doesn't answer. */
export async function recentEnvironments(
  api: Api,
  repo: string,
): Promise<{ environment: string; production: boolean }[]> {
  const res = await github<
    { environment?: string; production_environment?: boolean }[]
  >(api, `/repos/${repo}/deployments?per_page=50`).catch(() => null);
  if (res?.status !== 200 || !Array.isArray(res.data)) return [];
  const seen = new Map<string, boolean>();
  for (const d of res.data)
    if (typeof d.environment === "string" && !seen.has(d.environment))
      seen.set(
        d.environment,
        d.production_environment ??
          d.environment.toLowerCase() === "production",
      );
  return [...seen].map(([environment, production]) => ({
    environment,
    production,
  }));
}

/** Git's rules for a branch's name, the ones a person runs into. */
export function validBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 250 &&
    !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) &&
    !name.includes("..") &&
    !name.includes("@{") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name.includes("//")
  );
}

const repoPath = (repo: string) =>
  `/repos/${repo.split("/").map(encodeURIComponent).join("/")}`;
const refPath = (name: string) =>
  name.split("/").map(encodeURIComponent).join("/");

/** A repository's branches to start from: its default first, then the
 *  others by name — up to a hundred. */
export async function branchesOf(
  api: Api,
  repo: string,
): Promise<{ base: string | null; branches: string[] }> {
  const [info, list] = await Promise.all([
    github<{ default_branch?: string }>(api, repoPath(repo)),
    github<{ name?: string }[]>(api, `${repoPath(repo)}/branches?per_page=100`),
  ]);
  const base = info.data?.default_branch ?? null;
  const names = (Array.isArray(list.data) ? list.data : [])
    .map((b) => b.name)
    .filter((n): n is string => typeof n === "string" && n !== base)
    .sort((a, b) => a.localeCompare(b));
  return { base, branches: base ? [base, ...names] : names };
}

/** The plugin-data key Barynt keeps a branch under — the same as its
 *  GitHub link does, so a later event updates this one. */
export async function branchKey(repo: string, name: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(name),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  return `branch:${repo.replace(/[^A-Za-z0-9_.-]/g, ":")}:${hex}`;
}

/** Keeps the issue's entry for a branch — GitHub doesn't report back what
 *  the app did itself. Best effort: the branch is there either way. */
export async function recordBranch(
  api: Api,
  issueId: string,
  repo: string,
  name: string,
  deleted: boolean,
): Promise<void> {
  try {
    await api.issueData.set(issueId, await branchKey(repo, name), {
      kind: "branch",
      repo,
      name,
      url: deleted ? null : `https://github.com/${repo}/tree/${refPath(name)}`,
      deleted,
      at: new Date().toISOString(),
    });
  } catch {}
}

/** Renames one of the issue's branches; its entry follows. */
export async function renameBranch(
  api: Api,
  issueId: string,
  repo: string,
  from: string,
  to: string,
): Promise<void> {
  if (!validBranchName(to)) throw new BranchError(t("badBranchName"));
  const res = await github(
    api,
    `${repoPath(repo)}/branches/${refPath(from)}/rename`,
    { method: "POST", body: { new_name: to } },
  );
  if (res.status !== 201)
    throw new BranchError(
      res.status === 422
        ? t("branchNameTaken", { name: to })
        : res.status === 403 || res.status === 404
          ? t("noWriteRight", { repo })
          : t("answered", { status: res.status }),
    );
  try {
    await api.issueData.delete(issueId, await branchKey(repo, from));
  } catch {}
  await recordBranch(api, issueId, repo, to, false);
}

/** Deletes one of the issue's branches on GitHub; its entry says so. */
export async function deleteBranch(
  api: Api,
  issueId: string,
  repo: string,
  name: string,
): Promise<void> {
  const res = await github(
    api,
    `${repoPath(repo)}/git/refs/heads/${refPath(name)}`,
    { method: "DELETE" },
  );
  // Gone already counts as done.
  if (res.status !== 204 && res.status !== 422)
    throw new BranchError(
      res.status === 403 || res.status === 404
        ? t("noWriteRight", { repo })
        : t("answered", { status: res.status }),
    );
  await recordBranch(api, issueId, repo, name, true);
}

/** Whether GitHub lets this person at a repository — through their own
 *  account or the project's connection. */
export async function canReach(api: Api, repo: string): Promise<boolean> {
  try {
    return (await github(api, `/repos/${repo}`)).status === 200;
  } catch (error) {
    if (error instanceof BaryntError) return false;
    throw error;
  }
}
