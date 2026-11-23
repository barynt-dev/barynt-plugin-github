import type { Plugin } from "@barynt/plugin-sdk";
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
  init: { method?: "GET" | "POST"; body?: unknown } = {},
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
  return branchName(pattern, { user, key: issue.ref, title: issue.title });
}

/**
 * Creates the issue's branch in the project's first repository, from its
 * default branch — under the next free name if it's taken (`-2` … `-5`).
 * Then, as the project set it, assigns the issue to the person and sets
 * its status. Throws a `BranchError` that says what to do.
 */
export async function createBranch(
  api: Api,
  issueId: string,
): Promise<{ repo: string; name: string }> {
  const settings = await branchSettings(api);
  const repo = settings.repositories[0];
  if (!repo) throw new BranchError(t("pickRepository"));
  const name = await proposedName(api, issueId, settings.pattern);
  const info = await github<{ default_branch?: string }>(api, `/repos/${repo}`);
  if (info.status === 404) throw new BranchError(t("repoNotShown", { repo }));
  if (info.status === 401) throw new BranchError(t("tokenRefused"));
  const base = info.data?.default_branch;
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
