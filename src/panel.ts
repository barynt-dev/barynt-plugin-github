import { BaryntError, type Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  card,
  copyField,
  diffStat,
  list,
  notice,
  pickMenu,
  row,
  sectionHeader,
  stack,
  stepList,
  text,
  user,
} from "@barynt/plugin-sdk/ui";
import { createBranchAction, runWorkflowAction } from "./actions";
import { COMMITS_SHOWN, development, latestReviews } from "./development";
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
export async function renderDevelopment(
  api: Api,
  el: HTMLElement,
  issueId: string,
): Promise<void> {
  const data = await api.issueData.list([issueId]);
  const dev = development(data[issueId] ?? []);
  const parts: HTMLElement[] = [];

  parts.push(sectionHeader({ title: t("branch"), icon: "git-branch" }));
  if (dev.branches.length === 0) {
    // No branch yet: make one here, with the person's token (BARY-230).
    const status = stack(
      text({
        text: t("noBranchNames"),
        tone: "subtle",
        size: "sm",
      }),
    );
    const created = async (choice?: string) => {
      const result = await createBranchAction(api, issueId, choice);
      status.replaceChildren(
        notice({
          text: result.message ?? t("done"),
          tone: result.tone === "success" ? "success" : "warning",
        }),
      );
    };
    // Several repositories: the button picks which one.
    const { repositories } = await branchSettings(api).catch(() => ({
      repositories: [] as string[],
    }));
    const create =
      repositories.length > 1
        ? pickMenu({
            label: t("createBranch"),
            icon: "git-branch",
            options: repositories.map((repo, i) => ({
              value: repo,
              label: repo,
              ...(i === 0 && { hint: t("defaultRepo") }),
            })),
            onPick: (repo) => void created(repo),
          }).el
        : button({
            label: t("createBranch"),
            icon: "git-branch",
            size: "sm",
            variant: "secondary",
            onClick: () => created(),
          });
    parts.push(status, create);
  }
  for (const b of dev.branches)
    parts.push(
      copyField({
        value: b.name,
        icon: "git-branch",
        label: t("copyBranchName"),
        ...(b.url && { href: b.url }),
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

  if (dev.pullRequests.length > 0) {
    parts.push(
      sectionHeader({
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

  const panel = stack(...parts);
  panel.style.padding = "0.75rem";
  el.replaceChildren(panel);
}
