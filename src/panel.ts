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
  showMore,
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
/** Where a person's Branch section remembers being folded away. */
const FOLD_BRANCH = "fold:branch";

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

  const branchParts: HTMLElement[] = [];
  // Folded away or not — each person's own, kept with the plugin.
  const branchOpen =
    (await api.storage.personal.get<boolean>(FOLD_BRANCH).catch(() => null)) !==
    false;
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
          // Without an open one: GitHub's page to create it.
          ...(r.pr?.state === "open" || r.pr?.state === "draft"
            ? []
            : [
                {
                  label: t("createPullRequest"),
                  icon: "git-pull-request" as const,
                  onClick: () =>
                    run("create-pull-request", branchChoice(r.repo, r.name)),
                },
              ]),
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
    return field;
  };
  // Everything beyond the main branch behind one button, sorted inside:
  // the ones still being worked on, then the done ones (merged, deleted).
  const hidden = others.length + done.length;
  if (main) branchParts.push(branchRow(main));
  if (hidden > 0) {
    const both = others.length > 0 && done.length > 0;
    const group = (title: string, rows: BranchRow[], dim = false) => {
      const content = rows.map(branchRow);
      if (dim) for (const c of content) c.style.opacity = "0.6";
      if (!both) return content;
      const head = text({
        text: title,
        tone: "subtle",
        size: "xs",
        weight: "medium",
      });
      return [stack(head, ...content)];
    };
    branchParts.push(
      showMore({
        label: main
          ? t("moreBranches", { count: hidden })
          : t("doneBranches", { count: hidden }),
        content: [
          ...group(t("activeBranches"), others),
          ...group(t("finishedBranches"), done, true),
        ],
      }),
    );
  }
  // "+": another branch — in a window Barynt shows, with the name and the
  // branch it starts from to change (the `create-branch` action). The
  // section folds away under its head.
  parts.push(
    sectionHeader({
      title: t("branch"),
      icon: "git-branch",
      size: "sm",
      count: (main ? 1 : 0) + others.length,
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
      fold: {
        content: branchParts,
        open: branchOpen,
        onToggle: (open) => {
          void api.storage.personal.set(FOLD_BRANCH, open).catch(() => {});
        },
      },
    }),
  );

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

  // Pull requests and commits show before there are any: "+" opens
  // GitHub's page to create one (the `create-pull-request` action).
  parts.push(
    sectionHeader({
      size: "sm",
      title: t("pullRequests"),
      icon: "git-pull-request",
      count: dev.pullRequests.length,
      actions: [
        button({
          label: t("createPullRequest"),
          icon: "plus",
          iconOnly: true,
          size: "sm",
          variant: "ghost",
          onClick: () => run("create-pull-request"),
        }),
      ],
    }),
  );
  for (const { pr, steps } of dev.pullRequests)
    parts.push(pullRequestCard(api, pr, steps));

  parts.push(
    sectionHeader({
      size: "sm",
      title: t("commits"),
      icon: "git-commit-horizontal",
      count: dev.commits.length,
    }),
  );
  if (dev.commits.length > 0) {
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
        count: dev.deployments.length,
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
