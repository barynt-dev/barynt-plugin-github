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
  runWorkflow,
} from "./github";
import { t } from "./i18n";

// The issue's actions (BARY-230): in its menu, a card's quick actions and
// the palette. They run in a hidden frame — copying and opening a tab are
// Barynt's to do (`copy`, `open`).

type Api = Plugin["api"];

/** What a failure tells the person. */
export function explain(error: unknown): ActionResult {
  if (error instanceof BaryntError && error.code === "credential_missing")
    return {
      message: t("connectOrToken"),
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

/** With several repositories, which one the branch goes to — the first is
 *  where branches go by default. */
export async function branchRepoPick(api: Api): Promise<ActionResult | null> {
  const { repositories } = await branchSettings(api);
  if (repositories.length < 2) return null;
  return {
    pick: {
      title: t("pickBranchRepo"),
      icon: "lucide:git-branch",
      options: repositories.map((repo, i) => ({
        id: repo,
        label: repo,
        ...(i === 0 && { hint: t("defaultRepo") }),
      })),
    },
  };
}

export async function createBranchAction(
  api: Api,
  issueId: string,
  choice?: string,
): Promise<ActionResult> {
  try {
    // Several repositories: which one, first.
    if (!choice) {
      const pick = await branchRepoPick(api);
      if (pick) return pick;
    }
    const { repo, name } = await createBranch(api, issueId, choice);
    return {
      message: t("branchCreated", { name, repo }),
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
    return { copy: name, message: t("copied", { name }).slice(0, 120) };
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
      message: t("noBranchYet"),
      tone: "warning",
    };
  const issue = await api.issues.get(issueId);
  return {
    open: compareUrl(branch.repo, branch.name, `${issue.ref}: ${issue.title}`),
  };
}

/** Starts the project's workflow on the issue's branch (GitHub Actions). */
export async function runWorkflowAction(
  api: Api,
  issueId: string,
): Promise<ActionResult> {
  try {
    const { workflow } = await branchSettings(api);
    if (!workflow) return { message: t("pickWorkflow"), tone: "warning" };
    const { branch } = await knownBranch(api, issueId);
    if (!branch) return { message: t("noBranchYet"), tone: "warning" };
    await runWorkflow(api, branch.repo, branch.name, workflow);
    return {
      message: t("workflowStarted", { workflow, branch: branch.name }).slice(
        0,
        120,
      ),
      tone: "success",
    };
  } catch (error) {
    return explain(error);
  }
}
