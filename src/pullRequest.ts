import type { Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  diffStat,
  keyValue,
  list,
  notice,
  row,
  skeleton,
  stack,
  stageBar,
  tabs,
  text,
} from "@barynt/plugin-sdk/ui";
import type { WindowHost } from "./deployments";
import {
  development,
  prProgress,
  reviewer,
  withoutIssueKey,
} from "./development";
import { sortEntries } from "./entries";
import { branchRuns, type WorkflowRun } from "./github";
import { t } from "./i18n";
import { NEXT_TONE, nextText, reviews } from "./panel";
import { prLook } from "./row";
import { ago } from "./time";
import { latestRuns, renderRun, runLook, runStep } from "./workflows";

// A pull request's own window (BARY-238): the card in the panel stays
// short — stages and what's next — and "Details" opens this, as Linear
// does: an overview, the workflows its commits ran, who reviewed it and
// its commits, each a tab.

type Api = Plugin["api"];

export type PullRequestTab = "overview" | "workflows" | "reviews" | "commits";

/** What the window is told: which pull request, at which tab. */
export interface PullRequestWindow {
  repo: string;
  number: number;
  tab?: PullRequestTab;
}

const RUN_ICON = {
  success: "circle-check",
  danger: "circle-x",
  running: "loader-circle",
  warning: "triangle-alert",
  pending: "circle-dashed",
} as const;
const RUN_TONE = {
  success: "success",
  danger: "danger",
  running: "info",
  warning: "warning",
} as const;

/** How long a run took, or runs. */
function runDuration(run: WorkflowRun): string {
  if (!run.startedAt) return "";
  const end =
    run.status === "completed" && run.updatedAt
      ? Date.parse(run.updatedAt)
      : Date.now();
  const s = Math.max(0, Math.round((end - Date.parse(run.startedAt)) / 1000));
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function renderPullRequest(
  api: Api,
  el: HTMLElement,
  issueId: string,
  view: PullRequestWindow,
  host: WindowHost,
): Promise<void> {
  el.replaceChildren(skeleton({ lines: 5 }));
  const data = await api.issueData.list([issueId]);
  const raw = data[issueId] ?? [];
  const dev = development(raw);
  const found = dev.pullRequests.find(
    (p) => p.pr.repo === view.repo && p.pr.number === view.number,
  );
  if (!found) {
    el.replaceChildren(text({ text: t("prGone"), tone: "subtle" }));
    return;
  }
  const { pr, steps } = found;
  const open = pr.state === "open" || pr.state === "draft";
  const commits = sortEntries(raw).commits.filter(
    (c) => c.repo === pr.repo && (!pr.branch || c.branch === pr.branch),
  );
  const runs = pr.branch
    ? latestRuns(await branchRuns(api, pr.repo, pr.branch).catch(() => []), [])
    : [];
  const failed = runs.filter((r) => runStep(r) === "danger").length;

  // ─── Overview ──────────────────────────────────────────────────────────
  const overview = () => {
    const look = prLook(pr);
    const progress = open ? prProgress(pr, steps) : null;
    const parts: HTMLElement[] = [];
    if (progress)
      parts.push(
        stageBar({
          stages: progress.stages.map((s) => ({
            label: t(`stage_${s.stage}`),
            state: s.state,
          })),
        }),
        notice({
          text: nextText(progress.next),
          tone: NEXT_TONE[progress.next.kind],
          compact: true,
        }),
      );
    parts.push(
      keyValue({
        items: [
          {
            label: t("deployState"),
            value: badge({ text: look.text, tone: look.tone }),
          },
          {
            label: t("branch"),
            value: text({
              text: [pr.branch, pr.base].filter(Boolean).join(" → "),
              mono: true,
              size: "sm",
            }),
          },
          ...(pr.author
            ? [{ label: t("prAuthor"), value: reviewer(pr.author).name }]
            : []),
          ...(pr.additions !== null && pr.deletions !== null
            ? [
                {
                  label: t("prSize"),
                  value: diffStat({
                    added: pr.additions,
                    removed: pr.deletions,
                  }),
                },
              ]
            : []),
          { label: t("repository"), value: pr.repo },
          { label: t("prUpdated"), value: ago(pr.at) },
        ],
      }),
    );
    if (pr.url) {
      const foot = row(
        button({
          label: t("openOnGitHub"),
          icon: "external-link",
          variant: "primary",
          onClick: () => void window.open(pr.url ?? "", "_blank", "noopener"),
        }),
      );
      foot.style.justifyContent = "flex-end";
      parts.push(foot);
    }
    const box = stack(...parts);
    box.style.gap = "0.875rem";
    return box;
  };

  // ─── Workflows ─────────────────────────────────────────────────────────
  const workflows = () => {
    const slot = stack();
    const drawList = () => {
      host.setBack(null);
      slot.replaceChildren(
        runs.length
          ? list({
              items: runs.map((run) => ({
                title: run.name,
                note: [
                  run.event,
                  runDuration(run),
                  run.updatedAt ? ago(run.updatedAt) : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                icon: RUN_ICON[runStep(run)],
                ...(runStep(run) in RUN_TONE && {
                  tone: RUN_TONE[runStep(run) as keyof typeof RUN_TONE],
                }),
                aside: [badge(runLook(run))],
                // Its jobs and logs, here in the window.
                onClick: () =>
                  void renderRun(
                    api,
                    slot,
                    { repo: run.repo, runId: run.id, name: run.name },
                    host,
                    drawList,
                  ),
              })),
            })
          : text({ text: t("noWorkflowRuns"), tone: "subtle", size: "sm" }),
      );
    };
    drawList();
    return slot;
  };

  // ─── Reviews ───────────────────────────────────────────────────────────
  const reviewTab = () => {
    const slot = stack(skeleton({ lines: 2 }));
    void reviews(api, pr).then((node) => slot.replaceChildren(node));
    return slot;
  };

  // ─── Commits ───────────────────────────────────────────────────────────
  const commitTab = () =>
    list({
      empty: t("noCommits"),
      items: commits.map((c) => ({
        title: c.message,
        lead: [text({ text: c.sha.slice(0, 7), mono: true, size: "xs" })],
        meta: [c.author, ago(c.at)].filter(Boolean).join(" · "),
        ...(c.url && { href: c.url }),
      })),
    });

  const count = (label: string, n: number) => (n ? `${label} · ${n}` : label);
  el.replaceChildren(
    tabs({
      label: `#${pr.number} ${withoutIssueKey(pr.title)}`,
      value: view.tab ?? (failed > 0 ? "workflows" : "overview"),
      tabs: [
        { id: "overview", label: t("prOverview"), content: overview },
        {
          id: "workflows",
          label: count(t("workflowsTitle"), runs.length),
          content: workflows,
        },
        { id: "reviews", label: t("reviewsTitle"), content: reviewTab },
        {
          id: "commits",
          label: count(t("commits"), commits.length),
          content: commitTab,
        },
      ],
    }),
  );
}
