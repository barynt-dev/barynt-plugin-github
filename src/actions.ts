import {
  type ActionResult,
  BaryntError,
  type Plugin,
} from "@barynt/plugin-sdk";
import { compareUrl } from "./branch";
import { sortEntries } from "./entries";
import {
  BranchError,
  branchSettings,
  createBranch,
  proposedName,
} from "./github";

// The issue's actions (BARY-230): in its menu, a card's quick actions and
// the palette. They run in a hidden frame — copying and opening a tab are
// Barynt's to do (`copy`, `open`).

type Api = Plugin["api"];

/** What a failure tells the person. */
export function explain(error: unknown): ActionResult {
  if (error instanceof BaryntError && error.code === "credential_missing")
    return {
      message:
        "Connect GitHub in the project's settings → Plugins → GitHub, or keep your own token under your settings.",
      tone: "warning",
    };
  if (error instanceof BranchError)
    return { message: error.message, tone: "warning" };
  throw error;
}

/** The issue's branch Barynt knows of — the newest one still there. */
async function knownBranch(api: Api, issueId: string) {
  const data = await api.issueData.list([issueId]);
  const { branches, pullRequests } = sortEntries(data[issueId] ?? []);
  const branch = branches.find((b) => !b.deleted);
  return {
    branch: branch ? { repo: branch.repo, name: branch.name } : null,
    openPr: pullRequests.find(
      (p) =>
        (p.state === "open" || p.state === "draft") &&
        p.branch === branch?.name,
    ),
  };
}

export async function createBranchAction(
  api: Api,
  issueId: string,
): Promise<ActionResult> {
  try {
    const { repo, name } = await createBranch(api, issueId);
    return {
      message: `Branch ${name} created in ${repo}.`,
      tone: "success",
      openPanel: "development",
      refresh: true,
    };
  } catch (error) {
    return explain(error);
  }
}

export async function copyBranchNameAction(
  api: Api,
  issueId: string,
): Promise<ActionResult> {
  try {
    const { branch } = await knownBranch(api, issueId);
    const name =
      branch?.name ??
      (await proposedName(api, issueId, (await branchSettings(api)).pattern));
    return { copy: name, message: `Copied ${name}`.slice(0, 120) };
  } catch (error) {
    return explain(error);
  }
}

export async function openPullRequestAction(
  api: Api,
  issueId: string,
): Promise<ActionResult> {
  const { branch, openPr } = await knownBranch(api, issueId);
  if (openPr?.url) return { open: openPr.url };
  if (!branch)
    return {
      message: "No branch for this issue yet — create one first.",
      tone: "warning",
    };
  const issue = await api.issues.get(issueId);
  return {
    open: compareUrl(branch.repo, branch.name, `${issue.ref}: ${issue.title}`),
  };
}
