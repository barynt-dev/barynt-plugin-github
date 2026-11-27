import type { ModalOptions, Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  keyValue,
  link,
  list,
  notice,
  type PipelineStation,
  pipeline,
  row,
  type StepState,
  sectionHeader,
  stack,
  text,
  toast,
} from "@barynt/plugin-sdk/ui";
import { inOrder, lagging, stationRank } from "./development";
import type { Deployment, DeploymentRun } from "./entries";
import { sortEntries } from "./entries";
import { BranchError, recentEnvironments, rerunWorkflow } from "./github";
import { t } from "./i18n";
import { ago } from "./time";

// Where an issue's work runs (BARY-238): its environments as a line of
// stops, a preview first and production last, each opening a window with
// its details, its history and a way to run it again.

type Api = Plugin["api"];

/** What a modal of a deployment is told: which environment. */
export interface DeploymentView {
  repo: string;
  environment: string;
}

/** A deployment's state as a stop's tone and in a word. */
export function deploymentLook(state: DeploymentRun["state"]): {
  step: StepState;
  text: string;
  tone: "success" | "danger" | "info" | "neutral";
} {
  if (state === "success")
    return { step: "success", text: t("deployReady"), tone: "success" };
  if (state === "failure")
    return { step: "danger", text: t("deployFailed"), tone: "danger" };
  if (state === "pending")
    return { step: "running", text: t("deploying"), tone: "info" };
  return { step: "pending", text: t("deployInactive"), tone: "neutral" };
}

/** The environment's own address — not the log's, which `url` falls back
 *  to. */
export function appUrl(d: DeploymentRun): string | null {
  return d.url && d.url !== d.logUrl ? d.url : null;
}

const icon = (d: { environment: string; production: boolean }) => {
  const rank = stationRank(d);
  return rank === 4
    ? "rocket"
    : rank === 3
      ? "globe"
      : rank === 1
        ? "eye"
        : "package";
};

/** The environments a repository has, as GitHub lists its recent
 *  deployments, that the issue hasn't reached — staging and production
 *  only: previews come and go with each branch. */
async function notYet(
  api: Api,
  deployments: Deployment[],
): Promise<{ repo: string; environment: string; production: boolean }[]> {
  const repos = [...new Set(deployments.map((d) => d.repo))].slice(0, 3);
  const found = await Promise.all(
    repos.map(async (repo) =>
      (await recentEnvironments(api, repo)).map((e) => ({ ...e, repo })),
    ),
  );
  return found
    .flat()
    .filter(
      (e) =>
        stationRank(e) >= 3 &&
        !deployments.some(
          (d) => d.repo === e.repo && d.environment === e.environment,
        ),
    );
}

/** The panel's part: its head, the stops and, when one runs an older
 *  version than one before it, a line that says so. */
export async function deploymentParts(
  api: Api,
  deployments: Deployment[],
  commits: { sha: string }[],
  openModal: (options: ModalOptions) => void,
): Promise<HTMLElement[]> {
  if (deployments.length === 0) return [];
  const manyRepos = new Set(deployments.map((d) => d.repo)).size > 1;
  const missing = await notYet(api, deployments).catch(() => []);
  const stops = inOrder<
    | (Deployment & { reached: true })
    | { repo: string; environment: string; production: boolean; reached: false }
  >([
    ...deployments.map((d) => ({ ...d, reached: true as const })),
    ...missing.map((m) => ({ ...m, reached: false as const })),
  ]);
  const stations: PipelineStation[] = stops.map((s) => {
    const repo = manyRepos ? `${s.repo.split("/")[1] ?? s.repo} · ` : "";
    if (!s.reached)
      return {
        label: s.environment,
        icon: icon(s),
        state: "pending",
        status: t("deployNotYet"),
        ...(repo && { meta: repo.slice(0, -3) }),
      };
    const look = deploymentLook(s.state);
    const url = appUrl(s);
    return {
      label: s.environment,
      icon: icon(s),
      state: look.step,
      status: look.text,
      meta: `${repo}${ago(s.at)}`,
      onClick: () =>
        openModal({
          view: "deployment",
          title: s.environment,
          data: { repo: s.repo, environment: s.environment },
        }),
      ...(url && { link: { href: url, label: t("openApp") } }),
    };
  });
  const parts: HTMLElement[] = [
    sectionHeader({
      size: "sm",
      title: t("deployments"),
      icon: "rocket",
      count: deployments.length,
    }),
    pipeline({ stations, label: t("deployments") }),
  ];
  const lag = lagging(deployments, commits);
  if (lag)
    parts.push(
      notice({
        tone: "warning",
        compact: true,
        text:
          lag.commits === null
            ? t("deployBehind", {
                behind: lag.behind.environment,
                ahead: lag.ahead.environment,
              })
            : t("deployBehindBy", {
                behind: lag.behind.environment,
                ahead: lag.ahead.environment,
                count: lag.commits,
              }),
      }),
    );
  return parts;
}

/** A version as people read it: the short commit, and its message when
 *  the issue's commits have it. */
function version(
  run: DeploymentRun,
  commits: { sha: string; message: string }[],
): string {
  if (!run.sha) return run.ref ?? "—";
  const short = run.sha.slice(0, 7);
  const message = commits.find((c) => c.sha.startsWith(short))?.message;
  return message ? `${short} · ${message}` : short;
}

/** The window of one environment: what runs there, from what, by whom;
 *  the deployments before; running it again and opening the app. */
export async function renderDeployment(
  api: Api,
  el: HTMLElement,
  issueId: string,
  view: DeploymentView,
): Promise<void> {
  const data = await api.issueData.list([issueId]);
  const { deployments, commits } = sortEntries(data[issueId] ?? []);
  const d = deployments.find(
    (x) => x.repo === view.repo && x.environment === view.environment,
  );
  if (!d) {
    el.replaceChildren(text({ text: t("deployGone"), tone: "subtle" }));
    return;
  }
  const look = deploymentLook(d.state);
  const url = appUrl(d);
  const by = [
    d.workflow,
    ago(d.at),
    d.creator && t("deployBy", { name: d.creator }),
  ]
    .filter(Boolean)
    .join(" · ");
  const details = keyValue({
    items: [
      {
        label: t("deployState"),
        value: badge({ text: look.text, tone: look.tone }),
      },
      ...(url
        ? [
            {
              label: t("deployAddress"),
              value: link({ text: url.replace(/^https?:\/\//, ""), href: url }),
            },
          ]
        : []),
      {
        label: t("deployVersion"),
        value: text({
          text: [d.sha?.slice(0, 7), d.ref].filter(Boolean).join(" · ") || "—",
          mono: true,
        }),
      },
      { label: t("repository"), value: d.repo },
      { label: t("deployStarted"), value: by },
    ],
  });

  const runs: DeploymentRun[] = [d, ...(d.history ?? [])];
  const history = list({
    items: runs.map((r, i) => {
      const l = deploymentLook(r.state);
      return {
        title: version(r, commits),
        icon:
          r.state === "success"
            ? ("circle-check" as const)
            : r.state === "failure"
              ? ("circle-x" as const)
              : r.state === "pending"
                ? ("loader-circle" as const)
                : ("circle-dashed" as const),
        meta: ago(r.at),
        ...(r.logUrl && { href: r.logUrl }),
        aside: [
          badge({
            text: i === 0 && r.state === "success" ? t("deployActive") : l.text,
            tone: i === 0 && r.state === "success" ? "success" : l.tone,
          }),
        ],
      };
    }),
  });

  const actions: HTMLElement[] = [];
  const runId = d.runId;
  if (runId)
    actions.push(
      button({
        label: t("redeploy"),
        icon: "refresh-cw",
        onClick: async () => {
          try {
            await rerunWorkflow(api, d.repo, runId);
            toast(t("redeployStarted", { environment: d.environment }), {
              tone: "success",
            });
          } catch (error) {
            toast(
              error instanceof BranchError
                ? error.message
                : t("redeployFailed"),
              { tone: "danger" },
            );
          }
        },
      }),
    );
  if (d.logUrl)
    actions.push(
      button({
        label: t("deployLog"),
        icon: "terminal",
        variant: url ? "secondary" : "primary",
        onClick: () => void window.open(d.logUrl ?? "", "_blank", "noopener"),
      }),
    );
  if (url)
    actions.push(
      button({
        label: t("openApp"),
        icon: "external-link",
        variant: "primary",
        onClick: () => void window.open(url, "_blank", "noopener"),
      }),
    );

  const foot = row(...actions);
  foot.style.justifyContent = "flex-end";
  foot.style.flexWrap = "wrap";
  const body = stack(
    details,
    sectionHeader({
      size: "sm",
      title: t("deployHistory"),
      icon: "clock",
      count: runs.length,
    }),
    history,
    ...(actions.length ? [foot] : []),
  );
  body.style.gap = "0.75rem";
  body.style.padding = "0.25rem 0";
  el.replaceChildren(body);
}
