import {
  type ActionResult,
  BaryntError,
  type Plugin,
} from "@barynt/plugin-sdk";
import { compareUrl } from "./branch";
import { development } from "./development";
import { sortEntries } from "./entries";
import {
  BranchError,
  branchesOf,
  branchSettings,
  createBranch,
  deleteBranch,
  proposedName,
  renameBranch,
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

/** What Git doesn't take in a branch's name — checked as it's typed. */
const BRANCH_RULES = [
  { pattern: "\\s", message: "branchNoSpaces" },
  { pattern: "[~^:?*\\[\\\\\\x00-\\x1f\\x7f]", message: "branchNoChars" },
  { pattern: "\\.\\.|@\\{|//", message: "branchNoSequence" },
  { pattern: "^/|/$|\\.$|\\.lock$", message: "branchNoEdge" },
  { pattern: "^.{251,}$", message: "branchTooLong" },
] as const;

/**
 * The window to create a branch in: the repository (a choice with several,
 * the default marked), the name the issue gives — checked as it's typed,
 * against Git's rules and the repository's branches — and where it starts,
 * the repository's default first. Branches and what's taken follow the
 * repository picked.
 */
async function branchForm(
  api: Api,
  issueId: string,
  repo: string | undefined,
): Promise<ActionResult> {
  const settings = await branchSettings(api);
  const repos = settings.repositories;
  const first = repo && repos.includes(repo) ? repo : repos[0];
  if (!first) return { message: t("pickRepository"), tone: "warning" };
  const [name, ...lists] = await Promise.all([
    proposedName(api, issueId, settings.pattern),
    ...repos.map((r) =>
      branchesOf(api, r).catch(() => ({
        base: null as string | null,
        branches: [] as string[],
      })),
    ),
  ]);
  const per = (pick: (i: number) => object) =>
    Object.fromEntries(repos.map((r, i) => [r, pick(i)]));
  const baseOptions = (i: number) => {
    const { base, branches } = lists[i];
    // GitHub didn't list them: its default, whatever it's called.
    if (branches.length === 0) return [{ id: "", label: t("repoDefault") }];
    return branches.map((b) => ({
      id: b,
      label: b,
      ...(b === base && { hint: t("defaultBranch") }),
    }));
  };
  return {
    form: {
      title: t("createBranchTitle"),
      submitLabel: t("createBranch"),
      fields: [
        {
          id: "repo",
          label: t("repository"),
          type: "select",
          mono: true,
          value: first,
          options: repos.map((r, i) => ({
            id: r,
            label: r,
            ...(i === 0 && repos.length > 1 && { hint: t("defaultBranch") }),
          })),
        },
        {
          id: "name",
          label: t("branchNameLabel"),
          type: "text",
          value: name,
          required: true,
          mono: true,
          hint: t("branchNameHint"),
          invalid: BRANCH_RULES.map((r) => ({
            pattern: r.pattern,
            message: t(r.message),
          })),
          taken: { values: [], message: t("branchTaken") },
          dependsOn: "repo",
          per: per((i) => ({ taken: lists[i].branches })),
        },
        {
          id: "base",
          label: t("baseBranch"),
          type: "select",
          mono: true,
          options: baseOptions(repos.indexOf(first)),
          dependsOn: "repo",
          per: per((i) => ({ options: baseOptions(i) })),
        },
      ],
    },
  };
}

export async function createBranchAction(
  api: Api,
  issueId: string,
  choice?: string,
  values?: Record<string, string>,
): Promise<ActionResult> {
  try {
    // Where, what and from where, in one window.
    if (!values) return await branchForm(api, issueId, choice);
    const { repo, name } = await createBranch(
      api,
      issueId,
      values.repo || choice,
      {
        name: values.name,
        base: values.base,
      },
    );
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

/** A branch as a panel row hands it to its actions: `repo:name` — a
 *  branch's name never holds a colon. */
export const branchChoice = (repo: string, name: string) => `${repo}:${name}`;

function branchOfChoice(
  choice?: string,
): { repo: string; name: string } | null {
  const at = choice?.indexOf(":") ?? -1;
  if (!choice || at < 1) return null;
  return { repo: choice.slice(0, at), name: choice.slice(at + 1) };
}

/**
 * GitHub's page to create a pull request for one of the issue's branches,
 * its title the issue's (BARY-238): the one picked — else the only one
 * still without an open pull request, or which of several, asked first.
 */
export async function createPullRequestAction(
  api: Api,
  issueId: string,
  choice?: string,
): Promise<ActionResult> {
  const data = await api.issueData.list([issueId]);
  const { main, others } = development(data[issueId] ?? []).branchView;
  const active = [main, ...others].filter((b) => b !== null);
  const picked = branchOfChoice(choice);
  const without = active.filter(
    (b) => b.pr?.state !== "open" && b.pr?.state !== "draft",
  );
  const branch = picked
    ? active.find((b) => b.repo === picked.repo && b.name === picked.name)
    : without.length === 1
      ? without[0]
      : null;
  if (!branch) {
    if (active.length === 0)
      return { message: t("noBranchYet"), tone: "warning" };
    if (without.length === 0)
      return { message: t("allHavePullRequests"), tone: "neutral" };
    return {
      pick: {
        title: t("pickPullRequestBranch"),
        icon: "lucide:git-branch",
        options: without.map((b) => ({
          id: branchChoice(b.repo, b.name),
          label: b.name,
          hint: b.repo,
        })),
      },
    };
  }
  const issue = await api.issues.get(issueId);
  return {
    open: compareUrl(branch.repo, branch.name, `${issue.ref}: ${issue.title}`),
  };
}

/** Renames one of the issue's branches — its new name in a window. */
export async function renameBranchAction(
  api: Api,
  issueId: string,
  choice?: string,
  values?: Record<string, string>,
): Promise<ActionResult> {
  const branch = branchOfChoice(choice);
  if (!branch) return { message: t("pickBranch"), tone: "warning" };
  if (!values)
    return {
      form: {
        title: t("renameBranchTitle"),
        description: t("renameBranchIn", { repo: branch.repo }),
        submitLabel: t("renameBranch"),
        fields: [
          {
            id: "name",
            label: t("branchNameLabel"),
            type: "text",
            value: branch.name,
            required: true,
            mono: true,
          },
        ],
      },
    };
  const to = values.name?.trim() ?? "";
  if (!to || to === branch.name) return {};
  try {
    await renameBranch(api, issueId, branch.repo, branch.name, to);
    return {
      message: t("branchRenamed", { name: to }).slice(0, 120),
      tone: "success",
      refresh: true,
    };
  } catch (error) {
    return explain(error);
  }
}

/** Deletes one of the issue's branches on GitHub — asked first. */
export async function deleteBranchAction(
  api: Api,
  issueId: string,
  choice?: string,
  values?: Record<string, string>,
): Promise<ActionResult> {
  const branch = branchOfChoice(choice);
  if (!branch) return { message: t("pickBranch"), tone: "warning" };
  if (!values)
    return {
      form: {
        title: t("deleteBranchTitle"),
        description: t("deleteBranchText", {
          name: branch.name,
          repo: branch.repo,
        }),
        submitLabel: t("deleteBranch"),
        danger: true,
        fields: [],
      },
    };
  try {
    await deleteBranch(api, issueId, branch.repo, branch.name);
    return {
      message: t("branchDeleted", { name: branch.name }).slice(0, 120),
      tone: "success",
      refresh: true,
    };
  } catch (error) {
    return explain(error);
  }
}
