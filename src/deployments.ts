import type { ModalOptions, Plugin } from "@barynt/plugin-sdk";
import {
  accordion,
  badge,
  button,
  checkbox,
  keyValue,
  type LogLine,
  link,
  list,
  logView,
  navList,
  notice,
  type PipelineStation,
  pipeline,
  row,
  type StepState,
  sectionHeader,
  skeleton,
  stack,
  stepList,
  table,
  text,
  textArea,
  toast,
} from "@barynt/plugin-sdk/ui";
import { lagging } from "./development";
import type { Deployment, DeploymentRun } from "./entries";
import { sortEntries } from "./entries";
import {
  BranchError,
  type Job,
  jobLog,
  pendingDeployments,
  recentEnvironments,
  rerunFailed,
  rerunWorkflow,
  reviewDeployments,
  runJobs,
} from "./github";
import { t } from "./i18n";
import {
  type DeployConfig,
  OTHER,
  partsOf,
  readConfig,
  type Station,
  type StationState,
  servicesOf,
  stations,
  worst,
} from "./stages";
import { ago } from "./time";

// Where an issue's work runs (BARY-238): its deployments by stage — the
// project's, in its order — as a line of stops; with two services or more
// a matrix too. A click opens a window: what runs there, the workflow's
// jobs with their logs, the approval it waits for, the history.

type Api = Plugin["api"];
type Open = (options: ModalOptions) => void;

/** What a deployment's window is told. */
export interface DeploymentView {
  repo: string;
  environment: string;
  /** Opened to approve, or at the job that failed. */
  focus?: "approve" | "failed";
}

/** What a stage's window is told: which stage. */
export interface StageView {
  stage: string;
}

const FOLD_SERVICES = "fold:services";
/** How often a running job is asked again (ms). */
const POLL_MS = 5000;

/** A deployment's state in a word, its tone and its stop's state. */
export function deploymentLook(state: DeploymentRun["state"]): {
  step: StepState;
  text: string;
  tone: "success" | "danger" | "info" | "warning" | "neutral";
} {
  switch (state) {
    case "success":
      return { step: "success", text: t("deployReady"), tone: "success" };
    case "failure":
      return { step: "danger", text: t("deployFailed"), tone: "danger" };
    case "waiting":
      return { step: "warning", text: t("deployWaiting"), tone: "warning" };
    case "running":
      return { step: "running", text: t("deploying"), tone: "info" };
    case "pending":
      return { step: "running", text: t("deployQueued"), tone: "info" };
    case "cancelled":
      return { step: "pending", text: t("deployCancelled"), tone: "neutral" };
    default:
      return { step: "pending", text: t("deployInactive"), tone: "neutral" };
  }
}

const STATION_STEP: Record<StationState, StepState> = {
  failure: "danger",
  waiting: "warning",
  running: "running",
  success: "success",
  idle: "pending",
};

/** The environment's own address — not the log's, which `url` falls back
 *  to. */
export function appUrl(d: DeploymentRun): string | null {
  return d.url && d.url !== d.logUrl ? d.url : null;
}

/** The project's setting for deployments. */
export async function configOf(api: Api): Promise<DeployConfig> {
  const values = await api.settings.get().catch(() => ({}));
  return readConfig((values as Record<string, unknown>).deployments);
}

const ICON: Record<string, "eye" | "package" | "globe" | "rocket"> = {
  preview: "eye",
  test: "package",
  staging: "globe",
  production: "rocket",
};

/** One stop of the line: its state over its parts, what it says, where a
 *  click leads. */
function stop(station: Station, open: Open): PipelineStation {
  const { stage } = station;
  const icon = ICON[stage.id] ?? ("rocket" as const);
  if (!station.reached)
    return {
      label: stage.name,
      icon,
      state: "pending",
      status: t("deployNotYet"),
    };
  const parts = partsOf(station);
  const state = worst(parts.map((p) => p.state));
  const newest = station.deployments[0];
  const done = parts.filter((p) => p.state === "success").length;
  const previews =
    parts.length > 1 &&
    parts.every((p) => !p.placed.service && !p.placed.region);
  const regions = parts.length > 1 && parts.every((p) => p.placed.region);
  const status =
    parts.length === 1
      ? deploymentLook(newest.state).text
      : state === "failure"
        ? t("deployFailedOf", {
            count: parts.filter((p) => p.state === "failure").length,
            all: parts.length,
          })
        : state === "waiting"
          ? t("deployWaiting")
          : state === "running"
            ? t("deployRunningOf", { done, all: parts.length })
            : previews
              ? t("deployNewestReady")
              : regions
                ? t("deployRegions", { done, all: parts.length })
                : t("deployReadyOf", { done, all: parts.length });
  const running = parts.find(
    (p) => p.state === "running" || p.state === "pending",
  );
  const url = parts.map(appUrl).find(Boolean) ?? null;
  return {
    label: stage.name,
    icon,
    state: STATION_STEP[state],
    status,
    meta:
      running && parts.length > 1
        ? t("deployRunsAt", {
            name:
              running.placed.region ??
              running.placed.service ??
              running.environment,
          })
        : previews
          ? `${newest.environment} · ${ago(newest.at)}`
          : ago(newest.at),
    ...(previews && { count: parts.length }),
    ...(parts.length > 1 &&
      !previews && {
        segments: parts.map((p) => deploymentLook(p.state).step),
      }),
    ...(url && { link: { href: url, label: t("openApp") } }),
    onClick: () =>
      parts.length === 1
        ? open({
            view: "deployment",
            title: stage.name,
            data: { repo: newest.repo, environment: newest.environment },
          })
        : open({
            view: "stage",
            title: stage.name,
            data: { stage: stage.id },
          }),
  };
}

/** The environments the issue's repositories deploy to — for stops it
 *  hasn't reached yet. Empty when GitHub doesn't answer. */
async function expectedOf(api: Api, deployments: Deployment[]) {
  const repos = [...new Set(deployments.map((d) => d.repo))].slice(0, 3);
  const found = await Promise.all(
    repos.map((repo) => recentEnvironments(api, repo).catch(() => [])),
  );
  return found.flat();
}

/** The panel's part: its head, the stops — or, by service, a matrix —
 *  and a line for what needs someone: an approval, a failure. `redraw`
 *  draws the panel again (after switching to the matrix). */
export async function deploymentParts(
  api: Api,
  deployments: Deployment[],
  commits: { sha: string }[],
  open: Open,
  redraw: () => void = () => {},
): Promise<HTMLElement[]> {
  if (deployments.length === 0) return [];
  const [config, expected] = await Promise.all([
    configOf(api),
    expectedOf(api, deployments),
  ]);
  const list = stations(deployments, config, expected);
  const visible = list.flatMap((s) => s.deployments);
  if (list.length === 0) return [];

  const parts: HTMLElement[] = [
    sectionHeader({
      size: "sm",
      title: t("deployments"),
      icon: "rocket",
      count: visible.length,
    }),
  ];
  const services = servicesOf(list);
  const byService =
    services.length > 1 &&
    (await api.storage.personal
      .get<boolean>(FOLD_SERVICES)
      .catch(() => null)) === true;
  parts.push(
    byService
      ? matrix(list, services, open)
      : pipeline({
          stations: list.map((s) => stop(s, open)),
          label: t("deployments"),
        }),
  );
  if (services.length > 1)
    parts.push(
      button({
        label: byService ? t("deployCombine") : t("deployByService"),
        icon: byService ? "chevron-up" : "chevron-down",
        variant: "ghost",
        size: "sm",
        onClick: async () => {
          await api.storage.personal
            .set(FOLD_SERVICES, !byService)
            .catch(() => {});
          redraw();
        },
      }),
    );

  // What needs someone: the first approval it waits for, the first failure.
  const waiting = visible.find((d) => d.state === "waiting");
  if (waiting)
    parts.push(
      notice({
        tone: "warning",
        compact: true,
        text: t("deployWaitingFor", { stage: stageName(list, waiting) }),
        action: button({
          label: t("approveOpen"),
          size: "sm",
          onClick: () =>
            open({
              view: "deployment",
              title: stageName(list, waiting),
              data: {
                repo: waiting.repo,
                environment: waiting.environment,
                focus: "approve",
              },
            }),
        }),
      }),
    );
  const failed = visible.find((d) => d.state === "failure");
  if (failed)
    parts.push(
      notice({
        tone: "danger",
        compact: true,
        text:
          failed.environment.toLowerCase() ===
          stageName(list, failed).toLowerCase()
            ? t("deployFailedStage", { stage: stageName(list, failed) })
            : t("deployFailedAt", {
                stage: stageName(list, failed),
                environment: failed.environment,
              }),
        action: button({
          label: t("showLog"),
          size: "sm",
          onClick: () =>
            open({
              view: "deployment",
              title: stageName(list, failed),
              data: {
                repo: failed.repo,
                environment: failed.environment,
                focus: "failed",
              },
            }),
        }),
      }),
    );
  const lag = lagging(
    visible.filter((d) => d.placed.stage !== OTHER),
    commits,
  );
  if (lag && !waiting && !failed)
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

const stageName = (list: Station[], d: Deployment) =>
  list.find((s) => s.deployments.some((x) => x === d))?.stage.name ??
  d.environment;

const STATE_COLOR: Record<StationState, string> = {
  failure: "var(--barynt-color-danger)",
  waiting: "var(--barynt-color-warning)",
  running: "var(--barynt-color-info)",
  success: "var(--barynt-color-success)",
  idle: "var(--barynt-color-text-subtle)",
};
const STATE_ICON = {
  failure: "circle-x",
  waiting: "triangle-alert",
  running: "loader-circle",
  success: "circle-check",
  idle: "circle-dashed",
} as const satisfies Record<StationState, string>;

/** Services down, stages across: each cell the service's newest there. */
function matrix(list: Station[], services: string[], open: Open): HTMLElement {
  const columns = list.filter((s) => s.reached && s.stage.id !== OTHER);
  return table({
    caption: t("deployments"),
    columns: [
      { key: "service", label: t("deployService") },
      ...columns.map((c) => ({ key: c.stage.id, label: c.stage.name })),
    ],
    rows: services.map((service) => ({
      service: text({ text: service, weight: "semibold", size: "sm" }),
      ...Object.fromEntries(
        columns.map((c) => {
          const d = c.deployments.find((x) => x.placed.service === service);
          if (!d) return [c.stage.id, text({ text: "–", tone: "subtle" })];
          const state = worst([d.state]);
          const b = button({
            label: `${service} · ${c.stage.name}: ${deploymentLook(d.state).text}`,
            icon: STATE_ICON[state],
            iconOnly: true,
            variant: "ghost",
            size: "sm",
            onClick: () =>
              open({
                view: "deployment",
                title: `${c.stage.name} · ${service}`,
                data: { repo: d.repo, environment: d.environment },
              }),
          });
          b.style.color = STATE_COLOR[state];
          return [c.stage.id, b];
        }),
      ),
    })),
  });
}

// ─── The window ──────────────────────────────────────────────────────────────

/** What the window needs from outside: closing it, the settings. */
export interface WindowHost {
  close(): void;
  openSettings(level: "personal" | "project"): void;
}

function stateIcon(state: DeploymentRun["state"]) {
  return state === "success"
    ? ("circle-check" as const)
    : state === "failure"
      ? ("circle-x" as const)
      : state === "waiting"
        ? ("triangle-alert" as const)
        : state === "running" || state === "pending"
          ? ("loader-circle" as const)
          : ("circle-dashed" as const);
}

/** A stage's window: its parts — previews, regions, services — each a
 *  click away from its details. */
export async function renderStage(
  api: Api,
  el: HTMLElement,
  issueId: string,
  view: StageView,
  host: WindowHost,
): Promise<void> {
  const [data, config] = await Promise.all([
    api.issueData.list([issueId]),
    configOf(api),
  ]);
  const { deployments } = sortEntries(data[issueId] ?? []);
  const station = stations(deployments, config).find(
    (s) => s.stage.id === view.stage,
  );
  if (!station) {
    el.replaceChildren(text({ text: t("deployGone"), tone: "subtle" }));
    return;
  }
  const parts = partsOf(station);
  const nav = navList({
    items: parts.map((p) => ({
      label: `${[
        p.placed.service,
        p.placed.region,
        p.placed.service || p.placed.region ? null : p.environment,
      ]
        .filter(Boolean)
        .join(" · ")} — ${deploymentLook(p.state).text} · ${ago(p.at)}`,
      icon: stateIcon(p.state),
      onClick: () =>
        void renderDeployment(
          api,
          el,
          issueId,
          { repo: p.repo, environment: p.environment },
          host,
          () => void renderStage(api, el, issueId, view, host),
        ),
    })),
  });
  el.replaceChildren(stack(nav));
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

const backButton = (onBack: () => void) =>
  button({
    label: t("back"),
    icon: "chevron-left",
    variant: "ghost",
    size: "sm",
    onClick: onBack,
  });

const footOf = (actions: HTMLElement[]) => {
  const foot = row(...actions);
  foot.style.justifyContent = "flex-end";
  foot.style.flexWrap = "wrap";
  return foot;
};

/** One environment's window: what runs there, the approval it waits for,
 *  the workflow's jobs, the history; running it again, the app. */
export async function renderDeployment(
  api: Api,
  el: HTMLElement,
  issueId: string,
  view: DeploymentView,
  host: WindowHost,
  onBack?: () => void,
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
  const again = () =>
    void renderDeployment(
      api,
      el,
      issueId,
      { repo: view.repo, environment: view.environment },
      host,
      onBack,
    );
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
      {
        label: d.workflowFile
          ? t("deployWorkflowFile")
          : t("deployEnvironment"),
        value: text({ text: d.workflowFile ?? d.environment, mono: true }),
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

  const body = stack(...(onBack ? [backButton(onBack)] : []), details);
  body.style.gap = "0.875rem";
  body.style.padding = "0.25rem 0";
  el.replaceChildren(body);

  // The approval it waits for — asked as the person.
  if (d.state === "waiting" && d.runId) {
    const slot = stack(skeleton({ lines: 2 }));
    body.append(slot);
    void approvalBox(api, d, d.runId, host, again).then((node) => {
      slot.replaceChildren(node);
      if (view.focus === "approve") slot.scrollIntoView({ block: "nearest" });
    });
  }

  // The workflow's jobs — live from GitHub.
  if (d.runId) {
    const slot = stack(skeleton({ lines: 3 }));
    body.append(slot);
    void jobsBox(api, el, d, d.runId, view.focus === "failed", again, slot);
  }

  const runs: DeploymentRun[] = [d, ...(d.history ?? [])];
  body.append(
    sectionHeader({
      size: "sm",
      title: t("deployHistory"),
      icon: "clock",
      count: runs.length,
    }),
    list({
      items: runs.map((r, i) => {
        const l = deploymentLook(r.state);
        const active = i === 0 && r.state === "success";
        return {
          title: version(r, commits),
          icon: stateIcon(r.state),
          meta: ago(r.at),
          ...(r.logUrl && { href: r.logUrl }),
          aside: [
            badge({
              text: active ? t("deployActive") : l.text,
              tone: active ? "success" : l.tone,
            }),
          ],
        };
      }),
    }),
  );

  const actions: HTMLElement[] = [];
  const runId = d.runId;
  if (runId && d.state === "failure")
    actions.push(
      button({
        label: t("rerunFailedJobs"),
        icon: "refresh-cw",
        onClick: () => rerun(api, d.repo, { runId }, again),
      }),
    );
  else if (runId && (d.state === "success" || d.state === "cancelled"))
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
        label: t("onGitHub"),
        icon: "external-link",
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
  if (actions.length) body.append(footOf(actions));
}

async function rerun(
  api: Api,
  repo: string,
  target: { runId: number } | { jobId: number },
  after: () => void,
) {
  try {
    await rerunFailed(api, repo, target);
    toast(t("rerunStarted"), { tone: "success" });
    setTimeout(after, 2000);
  } catch (error) {
    toast(error instanceof BranchError ? error.message : t("redeployFailed"), {
      tone: "danger",
    });
  }
}

/** Approving or rejecting — or who may, when this person can't. */
async function approvalBox(
  api: Api,
  d: Deployment,
  runId: number,
  host: WindowHost,
  after: () => void,
): Promise<HTMLElement> {
  const pending = await pendingDeployments(api, d.repo, runId);
  if (pending === null)
    return notice({
      tone: "warning",
      title: t("approveTitle"),
      text: t("approveConnect"),
      action: button({
        label: t("approveConnectButton"),
        size: "sm",
        onClick: () => {
          host.close();
          host.openSettings("personal");
        },
      }),
    });
  if (pending.length === 0)
    return notice({ tone: "info", compact: true, text: t("approveNothing") });
  const mine = pending.filter((p) => p.canApprove);
  if (mine.length === 0)
    return notice({
      tone: "warning",
      title: t("approveTitle"),
      text: t("approveOthers", {
        names:
          [...new Set(pending.flatMap((p) => p.reviewers))].join(", ") || "—",
      }),
      action: button({
        label: t("onGitHub"),
        size: "sm",
        icon: "external-link",
        onClick: () => void window.open(d.logUrl ?? "", "_blank", "noopener"),
      }),
    });
  const picks = mine.map((p) =>
    checkbox({ label: p.environment, checked: true }),
  );
  const comment = textArea({
    label: t("approveComment"),
    rows: 2,
    placeholder: t("approveCommentHint"),
  });
  const send = (state: "approved" | "rejected") => async () => {
    const ids = mine
      .filter((_, i) => picks[i].value)
      .map((p) => p.environmentId);
    if (ids.length === 0) return;
    try {
      await reviewDeployments(api, d.repo, runId, ids, state, comment.value);
      toast(
        state === "approved"
          ? t("approvedToast", { count: ids.length })
          : t("rejectedToast", { count: ids.length }),
        { tone: "success" },
      );
      setTimeout(after, 2500);
    } catch (error) {
      toast(error instanceof BranchError ? error.message : t("approveFailed"), {
        tone: "danger",
      });
    }
  };
  const box = stack(
    notice({
      tone: "warning",
      title: t("approveTitle"),
      text: t("approveWaitsSince", { when: ago(d.at) }),
    }),
    ...(picks.length > 1 ? picks.map((p) => p.el) : []),
    comment.el,
    footOf([
      button({
        label: t("reject"),
        variant: "secondary",
        onClick: send("rejected"),
      }),
      button({
        label: t("approve"),
        icon: "check",
        variant: "primary",
        onClick: send("approved"),
      }),
    ]),
  );
  box.style.gap = "0.5rem";
  return box;
}

/** A job's or a step's state as a step. */
export function jobStep(status: string, conclusion: string | null): StepState {
  if (status !== "completed")
    return status === "waiting"
      ? "warning"
      : status === "in_progress"
        ? "running"
        : "pending";
  if (conclusion === "success") return "success";
  if (
    conclusion === "skipped" ||
    conclusion === "cancelled" ||
    conclusion === "neutral"
  )
    return "pending";
  return "danger";
}

/** How long, as people read it: 38s, 4:12. */
function duration(start: string | null, end: string | null): string {
  if (!start) return "";
  const s = Math.max(
    0,
    Math.round(
      ((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000,
    ),
  );
  if (s === 0) return "";
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Jobs together: a reusable workflow's (`deploy / migrate`) or a
 *  matrix's (`e2e (chrome)`) by what's before. */
export function groupJobs(jobs: Job[]): { name: string; jobs: Job[] }[] {
  const groups: { name: string; jobs: Job[] }[] = [];
  for (const job of jobs) {
    const name = job.name
      .split(" / ")[0]
      .replace(/\s*\(.*\)$/, "")
      .trim();
    const g = groups.find((x) => x.name === name);
    if (g) g.jobs.push(job);
    else groups.push({ name, jobs: [job] });
  }
  return groups;
}

function stepIcon(step: StepState) {
  return step === "success"
    ? ("circle-check" as const)
    : step === "danger"
      ? ("circle-x" as const)
      : step === "running"
        ? ("loader-circle" as const)
        : step === "warning"
          ? ("triangle-alert" as const)
          : ("circle-dashed" as const);
}

/** The run's jobs, grouped, the done groups folded; asked again while
 *  one runs. A click on a job shows its log. */
async function jobsBox(
  api: Api,
  el: HTMLElement,
  d: Deployment,
  runId: number,
  openFailed: boolean,
  back: () => void,
  slot: HTMLElement,
): Promise<void> {
  // Jobs the run skipped (`if:` false) aren't part of it.
  const jobs = (await runJobs(api, d.repo, runId))?.filter(
    (j) => j.conclusion !== "skipped",
  );
  if (!slot.isConnected) return;
  if (!jobs) {
    slot.replaceChildren(
      text({ text: t("jobsUnavailable"), tone: "subtle", size: "sm" }),
    );
    return;
  }
  const failed = jobs.find((j) => jobStep(j.status, j.conclusion) === "danger");
  if (openFailed && failed) {
    void renderLog(api, el, d, failed, back);
    return;
  }
  const doneCount = jobs.filter((j) => j.status === "completed").length;
  const items = groupJobs(jobs).map((g) => {
    const steps = g.jobs.map((j) => jobStep(j.status, j.conclusion));
    const settled = steps.every((s) => s === "success" || s === "pending");
    const word = steps.includes("danger")
      ? t("jobsGroupFailed")
      : steps.includes("warning")
        ? t("deployWaiting")
        : steps.includes("running")
          ? t("deploying")
          : steps.every((s) => s === "pending")
            ? t("deployQueued")
            : t("jobsGroupDone");
    return {
      title: `${g.name} · ${g.jobs.length > 1 ? `${t("jobCount", { count: g.jobs.length })} · ` : ""}${word}`,
      content: navList({
        items: g.jobs.map((j) => ({
          label: [j.name, duration(j.startedAt, j.completedAt)]
            .filter(Boolean)
            .join(" · "),
          icon: stepIcon(jobStep(j.status, j.conclusion)),
          onClick: () => void renderLog(api, el, d, j, back),
        })),
      }),
      open: !settled,
    };
  });
  slot.replaceChildren(
    sectionHeader({
      size: "sm",
      title: t("jobs"),
      icon: "terminal",
      meta: t("jobsDone", { done: doneCount, all: jobs.length }),
    }),
    accordion({ items }),
  );
  // Still running: ask again.
  if (jobs.some((j) => j.status !== "completed"))
    setTimeout(() => {
      if (slot.isConnected) void jobsBox(api, el, d, runId, false, back, slot);
    }, POLL_MS);
}

/** GitHub's log as lines: without times, `##[group]` a heading,
 *  `##[error]` an error, commands quiet. */
export function logLines(raw: string): LogLine[] {
  const out: LogLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const bare = line
      .replace(/^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z ?/, "")
      // Colours of the terminal: gone.
      .replace(/\u001b\[[\d;]*[A-Za-z]/g, "");
    if (bare.startsWith("##[endgroup]")) continue;
    const m = /^##\[(group|error|warning|debug|command|notice)\](.*)$/.exec(
      bare,
    );
    if (m) {
      const [, kind, rest] = m;
      if (kind === "group") out.push({ text: rest, heading: true });
      else if (kind === "error") out.push({ text: rest, tone: "danger" });
      else if (kind === "warning") out.push({ text: rest, tone: "warning" });
      else out.push({ text: rest, tone: "muted" });
    } else if (bare.startsWith("[command]"))
      out.push({ text: bare.slice(9), tone: "muted" });
    else out.push({ text: bare });
  }
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}

/** One job: its steps, and its log once it has one — asked again while it
 *  runs. Back leads to the deployment. */
export async function renderLog(
  api: Api,
  el: HTMLElement,
  d: Deployment,
  job: Job,
  back: () => void,
): Promise<void> {
  const state = jobStep(job.status, job.conclusion);
  const look =
    state === "danger"
      ? { text: t("deployFailed"), tone: "danger" as const }
      : state === "success"
        ? { text: t("jobsGroupDone"), tone: "success" as const }
        : state === "warning"
          ? { text: t("deployWaiting"), tone: "warning" as const }
          : state === "running"
            ? { text: t("deploying"), tone: "info" as const }
            : { text: t("deployQueued"), tone: "neutral" as const };
  const head = row(
    backButton(back),
    text({ text: job.name, weight: "semibold", size: "sm" }),
    badge(look),
  );
  head.style.alignItems = "center";
  head.style.flexWrap = "wrap";
  const steps = stepList({
    steps: job.steps.map((s) => ({
      label: s.name,
      state: jobStep(s.status, s.conclusion),
      meta: duration(s.startedAt, s.completedAt),
    })),
  });
  const logSlot = stack(skeleton({ lines: 4 }));
  const body = stack(head, steps, logSlot);
  body.style.gap = "0.75rem";
  body.style.padding = "0.25rem 0";
  el.replaceChildren(body);

  let logText = "";
  if (job.status === "completed") {
    const log = await jobLog(api, d.repo, job.id);
    if (!logSlot.isConnected) return;
    if ("text" in log) {
      logText = log.text;
      logSlot.replaceChildren(
        logView({ lines: logLines(log.text), maxHeight: 380, label: job.name }),
      );
    } else
      logSlot.replaceChildren(
        notice({
          tone: "info",
          compact: true,
          text:
            log.missing === "gone"
              ? t("logGone")
              : log.missing === "running"
                ? t("logNotYet")
                : t("logDenied"),
        }),
      );
  } else {
    logSlot.replaceChildren(
      notice({ tone: "info", compact: true, text: t("logWhileRunning") }),
    );
    // Its steps go on: ask again.
    setTimeout(async () => {
      if (!body.isConnected || !d.runId) return;
      const jobs = await runJobs(api, d.repo, d.runId);
      const now = jobs?.find((j) => j.id === job.id);
      if (now && body.isConnected) void renderLog(api, el, d, now, back);
    }, POLL_MS);
  }

  const tools: HTMLElement[] = [];
  if (logText)
    tools.push(
      button({
        label: t("copyLog"),
        icon: "copy",
        onClick: async () => {
          await navigator.clipboard.writeText(logText).catch(() => {});
          toast(t("copiedLog"));
        },
      }),
    );
  if (state === "danger")
    tools.push(
      button({
        label: t("rerunJob"),
        icon: "refresh-cw",
        onClick: () => rerun(api, d.repo, { jobId: job.id }, back),
      }),
    );
  if (job.url)
    tools.push(
      button({
        label: t("onGitHub"),
        icon: "external-link",
        variant: "primary",
        onClick: () => void window.open(job.url ?? "", "_blank", "noopener"),
      }),
    );
  if (tools.length) body.append(footOf(tools));
}
