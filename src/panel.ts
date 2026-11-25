import { BaryntError, type Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  card,
  copyField,
  diffStat,
  list,
  notice,
  row,
  sectionHeader,
  stack,
  stepList,
  text,
  user,
} from "@barynt/plugin-sdk/ui";
import { branchChoice, runWorkflowAction } from "./actions";
import {
  type BranchRow,
  COMMITS_SHOWN,
  development,
  latestReviews,
} from "./development";
import type { PullRequest } from "./entries";
import { branchSettings } from "./github";
import { t } from "./i18n";
import { prLook } from "./row";

// The "Development" panel in an issue's sidebar (BARY-229): its branch,
// its pull requests with their checks, size and reviews, and the commits
// that name it. What Barynt keeps comes first; who reviewed comes live from
// GitHub, with the person's own token.

type Api = Plugin["api"];

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return t("minutesAgo", { count: Math.max(minutes, 1) });
  if (minutes < 60 * 24)
    return t("hoursAgo", { count: Math.round(minutes / 60) });
  return t("daysAgo", { count: Math.round(minutes / 60 / 24) });
};

/** Who reviewed, from GitHub — or why it can't say. */
async function reviews(api: Api, pr: PullRequest): Promise<HTMLElement> {
  try {
    const res = await api.net.fetch(
      `https://api.github.com/repos/${pr.repo}/pulls/${pr.number}/reviews?per_page=100`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok)
      return text({
        text: t("reviewsAnswered", { status: res.status }),
        tone: "subtle",
        size: "sm",
      });
    const latest = latestReviews(res.json());
    if (latest.length === 0)
      return text({ text: t("noReviews"), tone: "subtle", size: "sm" });
    return stack(
      ...latest.map((r) =>
        user({
          name: r.login,
          meta: r.state === "approved" ? t("approved") : t("changesRequested"),
        }),
      ),
    );
  } catch (error) {
    if (error instanceof BaryntError && error.code === "credential_missing")
      return notice({
        text: t("connectForReviews"),
        tone: "info",
      });
    return text({
      text: t("reviewsFailed"),
      tone: "subtle",
      size: "sm",
    });
  }
}

function pullRequestCard(
  api: Api,
  pr: PullRequest,
  steps: { label: string; state: import("@barynt/plugin-sdk/ui").StepState }[],
): HTMLElement {
  const look = prLook(pr);
  const who = stack();
  who.append(text({ text: t("loadingReviews"), tone: "subtle", size: "sm" }));
  if (pr.state === "open" || pr.state === "draft")
    void reviews(api, pr).then((el) => who.replaceChildren(el));
  else who.replaceChildren();
  // The state first, in the row: the sidebar is too narrow for it beside
  // the title.
  const meta = row(
    badge({ text: look.text, tone: look.tone }),
    ...(pr.additions !== null && pr.deletions !== null
      ? [diffStat({ added: pr.additions, removed: pr.deletions })]
      : []),
    text({
      text: [pr.author, ago(pr.at)].filter(Boolean).join(" · "),
      tone: "subtle",
      size: "xs",
      inline: true,
    }),
  );
  return card({
    title: `${pr.repo}#${pr.number}`,
    description: pr.title,
    compact: true,
    children: [
      meta,
      ...(steps.length > 0 ? [stepList({ steps })] : []),
      ...(pr.state === "open" || pr.state === "draft" ? [who] : []),
      ...(pr.url
        ? [
            button({
              label: t("openOnGitHub"),
              icon: "external-link",
              size: "sm",
              variant: "ghost",
              onClick: () => {
                window.open(pr.url as string, "_blank", "noopener");
              },
            }),
          ]
        : []),
    ],
  });
}

/** Draws the panel for an issue into `el`. */
/** A branch's line under its name: its pull request, its checks — or
 *  that it's gone. */
function branchStatus(r: BranchRow): string | null {
  const parts: string[] = [];
  if (r.deleted) parts.push(t("branchGone"));
  if (r.pr) parts.push(`PR #${r.pr.number} · ${prLook(r.pr).text}`);
  if (r.checks && r.checks !== "neutral" && !r.deleted)
    parts.push(t(`checks_${r.checks}`));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export async function renderDevelopment(
  api: Api,
  el: HTMLElement,
  issueId: string,
  /** Starts one of the plugin's actions for the issue — Barynt shows its
   *  windows and answers (`Plugin.runAction`). */
  run: (actionId: string, choice?: string) => void,
): Promise<void> {
  const data = await api.issueData.list([issueId]);
  const dev = development(data[issueId] ?? []);
  const parts: HTMLElement[] = [];

  // "+": another branch — in a window Barynt shows, with the name and the
  // branch it starts from to change (the `create-branch` action).
  parts.push(
    sectionHeader({
      title: t("branch"),
      icon: "git-branch",
      size: "sm",
      actions: [
        button({
          label: t("createBranch"),
          icon: "plus",
          iconOnly: true,
          size: "sm",
          variant: "ghost",
          onClick: () => run("create-branch"),
        }),
      ],
    }),
  );
  // The branch that matters most on top; the others still being worked on
  // folded below it, the done ones (deleted, merged) apart.
  const { main, others, done } = dev.branchView;
  const branchRow = (r: BranchRow): HTMLElement => {
    const field = copyField({
      value: r.name,
      icon: "git-branch",
      label: t("copyBranchName"),
      ...(r.url && !r.deleted && { href: r.url }),
      ...(!r.deleted && {
        menu: [
          {
            label: t("renameBranch"),
            icon: "pencil" as const,
            onClick: () => run("rename-branch", branchChoice(r.repo, r.name)),
          },
          {
            label: t("deleteBranch"),
            icon: "trash" as const,
            danger: true,
            onClick: () => run("delete-branch", branchChoice(r.repo, r.name)),
          },
        ],
      }),
    });
    const status = branchStatus(r);
    if (!status) return field;
    const line = text({ text: status, tone: "subtle", size: "xs" });
    // Under the name, past its icon.
    line.style.paddingLeft = "2.25rem";
    const box = stack(field, line);
    box.style.gap = "0.25rem";
    return box;
  };
  const fold = (title: string, rows: BranchRow[], dim = false) => {
    const content = rows.map(branchRow);
    if (dim) for (const c of content) c.style.opacity = "0.6";
    return sectionHeader({
      title,
      size: "sm",
      fold: { content, open: false },
    });
  };
  if (!main)
    parts.push(
      text({ text: t("noBranchNames"), tone: "subtle", size: "sm" }),
      button({
        label: t("createBranch"),
        icon: "git-branch",
        size: "sm",
        variant: "secondary",
        onClick: () => run("create-branch"),
      }),
    );
  else parts.push(branchRow(main));
  if (others.length > 0)
    parts.push(fold(t("moreBranches", { count: others.length }), others));
  if (done.length > 0)
    parts.push(fold(t("doneBranches", { count: done.length }), done, true));
  // The project's workflow, on the issue's branch (GitHub Actions).
  if (dev.branches.length > 0) {
    const { workflow } = await branchSettings(api).catch(() => ({
      workflow: null,
    }));
    if (workflow) {
      const status = stack();
      parts.push(
        row(
          button({
            label: t("runWorkflow"),
            icon: "play",
            size: "sm",
            variant: "secondary",
            onClick: async () => {
              const result = await runWorkflowAction(api, issueId);
              status.replaceChildren(
                notice({
                  text: result.message ?? t("done"),
                  tone: result.tone === "success" ? "success" : "warning",
                }),
              );
            },
          }),
          text({
            text: workflow,
            mono: true,
            size: "xs",
            tone: "subtle",
            inline: true,
          }),
        ),
        status,
      );
    }
  }

  if (dev.pullRequests.length > 0) {
    parts.push(
      sectionHeader({
        size: "sm",
        title: t("pullRequests"),
        icon: "git-pull-request",
        meta: String(dev.pullRequests.length),
      }),
    );
    for (const { pr, steps } of dev.pullRequests)
      parts.push(pullRequestCard(api, pr, steps));
  }

  if (dev.commits.length > 0) {
    parts.push(
      sectionHeader({
        size: "sm",
        title: t("commits"),
        icon: "git-commit-horizontal",
        meta: String(dev.commits.length),
      }),
    );
    const list = stack();
    const show = (count: number): void => {
      list.replaceChildren(
        ...dev.commits.slice(0, count).map((c) =>
          row(
            text({
              text: c.sha,
              mono: true,
              size: "xs",
              tone: "primary",
              inline: true,
            }),
            text({ text: c.message, size: "sm", inline: true }),
          ),
        ),
        ...(count < dev.commits.length
          ? [
              button({
                label: t("showAll", { count: dev.commits.length }),
                size: "sm",
                variant: "ghost",
                onClick: () => show(dev.commits.length),
              }),
            ]
          : []),
      );
    };
    show(COMMITS_SHOWN);
    parts.push(list);
  }

  if (dev.deployments.length > 0) {
    parts.push(
      sectionHeader({
        size: "sm",
        title: t("deployments"),
        icon: "rocket",
        meta: String(dev.deployments.length),
      }),
      list({
        items: dev.deployments.map((d) => ({
          title: d.environment,
          icon: d.production ? ("rocket" as const) : ("globe" as const),
          meta: [d.repo, ago(d.at)].join(" · "),
          ...(d.url && { href: d.url }),
          aside: [
            ...(d.production
              ? [badge({ text: t("production"), tone: "primary" })]
              : []),
            badge({
              text:
                d.state === "success"
                  ? t("deployedOk")
                  : d.state === "failure"
                    ? t("deployFailed")
                    : t("deploying"),
              tone:
                d.state === "success"
                  ? "success"
                  : d.state === "failure"
                    ? "danger"
                    : "neutral",
            }),
          ],
        })),
      }),
    );
  }

  // In the issue's sidebar, without a box: edge to edge with its fields,
  // the quiet heads a little closer to what they head.
  const panel = stack(...parts);
  panel.style.padding = "0.25rem 0 0.5rem";
  panel.style.gap = "0.625rem";
  el.replaceChildren(panel);
}
