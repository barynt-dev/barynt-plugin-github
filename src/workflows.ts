import type { ModalOptions, Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  type Field,
  list,
  notice,
  row,
  type StepState,
  sectionHeader,
  segmentedControl,
  select,
  skeleton,
  stack,
  text,
  textField,
  toast,
  toggle,
} from "@barynt/plugin-sdk/ui";
import {
  backTo,
  configOf,
  jobStep,
  jobsBox,
  type WindowHost,
} from "./deployments";
import { reviewer } from "./development";
import type { Deployment } from "./entries";
import {
  BranchError,
  branchRuns,
  dispatchWorkflow,
  getRun,
  repoEnvironmentNames,
  rerunFailed,
  type WorkflowInput,
  type WorkflowRun,
  workflowInputs,
} from "./github";
import { t } from "./i18n";
import type { WorkflowSetting } from "./stages";
import { ago } from "./time";

// The issue's workflows (BARY-238): the GitHub Actions runs on its
// branches that aren't a deployment — the newest per workflow, folded to
// one line unless one failed — and starting one from the issue, its
// inputs read from the workflow's file and filled from the issue.

type Api = Plugin["api"];
type Open = (options: ModalOptions) => void;

const FOLD_WORKFLOWS = "fold:workflows";
/** How often the section looks again while a run goes on (ms). */
const POLL_MS = 15_000;

/** What a run's window is told. */
export interface RunWindow {
  repo: string;
  runId: number;
  name: string;
}

/** A run's state as a step: done, failed, running, waiting. */
export function runStep(run: WorkflowRun): StepState {
  return jobStep(run.status, run.conclusion);
}

/** A run's state, in colour — none for one that didn't run. */
const RUN_TONE: Partial<
  Record<StepState, "success" | "danger" | "warning" | "info">
> = {
  success: "success",
  danger: "danger",
  running: "info",
  warning: "warning",
};

const STEP_ICON = {
  success: "circle-check",
  danger: "circle-x",
  running: "loader-circle",
  warning: "triangle-alert",
  pending: "circle-dashed",
} as const;

/** A run's state in a word, in its tone — a cancelled or skipped one
 *  says so. */
export function runLook(run: WorkflowRun): {
  text: string;
  tone: "success" | "danger" | "warning" | "info" | "neutral";
} {
  if (run.conclusion === "cancelled" || run.conclusion === "skipped")
    return { text: t("deployCancelled"), tone: "neutral" };
  const step = runStep(run);
  return step === "danger"
    ? { text: t("deployFailed"), tone: "danger" }
    : step === "success"
      ? { text: t("jobsGroupDone"), tone: "success" }
      : step === "warning"
        ? { text: t("deployWaiting"), tone: "warning" }
        : step === "running"
          ? { text: t("deploying"), tone: "info" }
          : { text: t("deployQueued"), tone: "neutral" };
}

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

/** The newest run per workflow on the issue's branches — not the ones
 *  hidden, nor the ones counted as a deployment (shown above). Failed
 *  first, then running, then the rest by when. */
export function latestRuns(
  runs: WorkflowRun[],
  settings: WorkflowSetting[],
): WorkflowRun[] {
  const newest = new Map<string, WorkflowRun>();
  for (const run of [...runs].sort((a, b) => b.id - a.id)) {
    const key = `${run.repo}|${run.file}`;
    if (!newest.has(key)) newest.set(key, run);
  }
  const rank = (r: WorkflowRun) => {
    const step = runStep(r);
    return step === "danger"
      ? 0
      : step === "running" || step === "warning"
        ? 1
        : 2;
  };
  return [...newest.values()]
    .filter((run) => {
      const own = settings.find((w) => w.workflow === run.file);
      return own?.show !== false && !own?.stage;
    })
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
}

/** The issue's branches that still exist, with their repository. */
type Branch = { name: string; repo: string };

/**
 * The panel's Workflows section: one folded line saying how they went —
 * open when one failed, or as the person left it — with the newest run of
 * each and, for who may, "Start workflow…". Asked again while one runs.
 */
export async function workflowParts(
  api: Api,
  branches: Branch[],
  open: Open,
  redraw: () => void,
): Promise<HTMLElement[]> {
  const [config, me] = await Promise.all([
    configOf(api),
    api.me.get().catch(() => null),
  ]);
  const startable = config.workflows.filter(
    (w) => w.start && (w.startBy !== "managers" || me?.canManage),
  );
  const all = (
    await Promise.all(
      branches
        .slice(0, 3)
        .map((b) => branchRuns(api, b.repo, b.name).catch(() => [])),
    )
  ).flat();
  const runs = latestRuns(all, config.workflows);
  // Workflows the project hides from issues — said so, not "none".
  const hidden = latestRuns(all, []).filter((r) =>
    config.workflows.some((w) => w.workflow === r.file && w.show === false),
  ).length;
  if (runs.length === 0 && startable.length === 0 && hidden === 0) return [];

  const failed = runs.filter((r) => runStep(r) === "danger").length;
  const running = runs.filter((r) =>
    ["running", "warning"].includes(runStep(r)),
  ).length;
  const kept = await api.storage.personal
    .get<boolean>(FOLD_WORKFLOWS)
    .catch(() => null);
  const status =
    failed > 0
      ? {
          text: t("workflowsFailed", { count: failed }),
          tone: "danger" as const,
        }
      : running > 0
        ? {
            text: t("workflowsRunning", { count: running }),
            tone: "info" as const,
          }
        : runs.length
          ? {
              text: t("workflowsPassed", { count: runs.length }),
              tone: "success" as const,
            }
          : undefined;
  const content: HTMLElement[] = [];
  if (runs.length)
    content.push(
      list({
        items: runs.slice(0, 12).map((run) => {
          const look = runLook(run);
          return {
            title: run.name,
            note: [
              run.event === "workflow_dispatch" && run.actor
                ? t("startedBy", { name: reviewer(run.actor).name })
                : run.event,
              // The branch only when the issue has more than one.
              branches.length > 1 ? run.branch : null,
              runDuration(run),
              run.updatedAt ? ago(run.updatedAt) : null,
            ]
              .filter(Boolean)
              .join(" · "),
            icon: STEP_ICON[runStep(run)],
            ...(RUN_TONE[runStep(run)] && { tone: RUN_TONE[runStep(run)] }),
            aside: [badge(look)],
            onClick: () =>
              open({
                view: "run",
                title: run.name,
                data: { repo: run.repo, runId: run.id, name: run.name },
              }),
          };
        }),
      }),
    );
  else
    content.push(
      text({
        text: hidden
          ? t("workflowsHidden", { count: hidden })
          : t("noWorkflowRuns"),
        tone: "subtle",
        size: "sm",
      }),
    );
  const section = sectionHeader({
    size: "sm",
    title: t("workflowsTitle"),
    icon: "play",
    count: runs.length,
    ...(status && { status }),
    // Starting one, as a branch is created: a "+" in the head.
    ...(startable.length &&
      branches.length && {
        actions: [
          button({
            label: t("startWorkflowTitle"),
            icon: "plus",
            iconOnly: true,
            size: "sm",
            variant: "ghost",
            onClick: () =>
              open({
                view: "start",
                title: t("startWorkflowTitle"),
                size: "md",
              }),
          }),
        ],
      }),
    fold: {
      content,
      // A failure opens it, whatever was kept.
      open: failed > 0 || kept === true,
      onToggle: (on) => {
        void api.storage.personal.set(FOLD_WORKFLOWS, on).catch(() => {});
      },
    },
  });
  // Something runs: look again in a while.
  if (running > 0)
    setTimeout(() => {
      if (section.isConnected) redraw();
    }, POLL_MS);
  return [section];
}

// ─── A run's window ──────────────────────────────────────────────────────────

/** A run in a window: which one, its jobs with their logs, running it
 *  again, GitHub. */
export async function renderRun(
  api: Api,
  el: HTMLElement,
  view: RunWindow,
  host: WindowHost,
  onBack?: () => void,
): Promise<void> {
  el.replaceChildren(skeleton({ lines: 4 }));
  const run = await getRun(api, view.repo, view.runId);
  if (!run) {
    el.replaceChildren(
      text({ text: t("jobsUnavailable"), tone: "subtle", size: "sm" }),
    );
    return;
  }
  const again = () => void renderRun(api, el, view, host, onBack);
  backTo(host, onBack);
  const step = runStep(run);
  const look = runLook(run);
  const title = row(
    text({ text: run.name, weight: "semibold", size: "base" }),
    badge(look),
  );
  title.style.alignItems = "center";
  title.style.flexWrap = "wrap";
  const facts = [
    run.number ? `#${run.number}` : null,
    run.event === "workflow_dispatch" && run.actor
      ? t("startedBy", { name: reviewer(run.actor).name })
      : run.event,
    run.branch,
    run.sha?.slice(0, 7),
    runDuration(run),
    run.updatedAt ? ago(run.updatedAt) : null,
  ].filter(Boolean);
  const head = stack(
    title,
    text({ text: facts.join(" · "), size: "xs", tone: "subtle" }),
  );
  head.style.gap = "0.25rem";

  // The run, as the deployments' window takes it: its jobs and logs.
  const asRun: Deployment = {
    kind: "deployment",
    repo: run.repo,
    environment: run.name,
    production: false,
    workflowFile: run.file,
    state: "success",
    ref: run.branch,
    sha: run.sha,
    url: run.url,
    logUrl: run.url,
    workflow: run.name,
    runId: run.id,
    at: run.updatedAt ?? run.startedAt ?? new Date().toISOString(),
  };
  const jobs = stack(skeleton({ lines: 3 }));
  const actions = [
    ...(step === "danger"
      ? [
          button({
            label: t("rerunFailedJobs"),
            icon: "refresh-cw",
            onClick: async () => {
              try {
                await rerunFailed(api, run.repo, { runId: run.id });
                toast(t("rerunStarted"), { tone: "success" });
                setTimeout(again, 2000);
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
        ]
      : []),
    ...(run.url
      ? [
          button({
            label: t("onGitHub"),
            icon: "external-link",
            variant: "primary",
            onClick: () =>
              void window.open(run.url ?? "", "_blank", "noopener"),
          }),
        ]
      : []),
  ];
  const foot = row(...actions);
  foot.style.justifyContent = "flex-end";
  foot.style.flexWrap = "wrap";
  const body = stack(head, jobs, ...(actions.length ? [foot] : []));
  body.style.gap = "0.875rem";
  body.style.padding = "0.25rem 0";
  el.replaceChildren(body);
  void jobsBox(api, el, asRun, run.id, false, again, jobs, host);
}

// ─── Starting a workflow ─────────────────────────────────────────────────────

/** `{key}`, `{title}`, `{branch}`, `{assignee}` filled in from the issue. */
export function fillTemplate(
  template: string,
  issue: { ref: string; title: string; assignee?: { name: string } | null },
  branch: string,
): string {
  return template.replace(/\{(key|title|branch|assignee)\}/g, (_, k) =>
    k === "key"
      ? issue.ref
      : k === "title"
        ? issue.title
        : k === "branch"
          ? branch
          : (issue.assignee?.name ?? ""),
  );
}

/**
 * "Start workflow": the workflows the project lets start (and this person
 * may), the repository and branch — the issue's by default — and a field
 * per input the workflow's file declares, filled from the issue where the
 * project says so. Started as the person, else through the app.
 */
export async function renderStart(
  api: Api,
  el: HTMLElement,
  issueId: string,
  branches: Branch[],
  host: WindowHost,
): Promise<void> {
  el.replaceChildren(skeleton({ lines: 5 }));
  const [config, me, issue] = await Promise.all([
    configOf(api),
    api.me.get().catch(() => null),
    api.issues.get(issueId).catch(() => null),
  ]);
  const values = (await api.settings.get().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const repos = Array.isArray(values.repositories)
    ? (values.repositories as string[])
    : [];
  const allowed = config.workflows.filter(
    (w) => w.start && (w.startBy !== "managers" || me?.canManage),
  );
  if (!allowed.length || !issue) {
    el.replaceChildren(
      notice({ tone: "info", text: t("noStartableWorkflows") }),
    );
    return;
  }

  let workflow = allowed[0];
  let repo = branches[0]?.repo ?? repos[0] ?? "";
  const branchField = textField({
    label: t("branch"),
    value: branches[0]?.name ?? "",
    hint: t("branchOfIssue"),
  });
  const formSlot = stack();
  let fields: { input: WorkflowInput; field: Field<string | boolean> }[] = [];

  const drawInputs = async () => {
    formSlot.replaceChildren(skeleton({ lines: 3 }));
    const [inputs, environments] = await Promise.all([
      workflowInputs(api, repo, workflow.workflow),
      repoEnvironmentNames(api, repo).catch(() => []),
    ]);
    if (inputs === null) {
      formSlot.replaceChildren(
        notice({
          tone: "warning",
          compact: true,
          text: t("workflowNoDispatch", { workflow: workflow.workflow }),
        }),
      );
      fields = [];
      return;
    }
    fields = inputs.map((input) => {
      const preset = workflow.prefill?.[input.name];
      const initial = preset
        ? fillTemplate(preset, issue, branchField.value)
        : input.default;
      const label = input.required ? `${input.name} *` : input.name;
      const hint = [
        input.description,
        preset ? t("prefilledFrom", { template: preset }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const field: Field<string | boolean> =
        input.type === "boolean"
          ? (toggle({
              label,
              ...(hint && { hint }),
              checked: initial === true || initial === "true",
            }) as Field<string | boolean>)
          : input.type === "choice" && input.options.length <= 4
            ? (segmentedControl({
                label,
                ...(hint && { hint }),
                options: input.options.map((o) => ({ value: o, label: o })),
                value: String(initial ?? input.options[0] ?? ""),
              }) as Field<string | boolean>)
            : input.type === "choice" || input.type === "environment"
              ? (select({
                  label,
                  ...(hint && { hint }),
                  options: (input.type === "environment"
                    ? environments
                    : input.options
                  ).map((o) => ({ value: o, label: o })),
                  value: String(
                    initial ??
                      (input.type === "environment"
                        ? environments[0]
                        : input.options[0]) ??
                      "",
                  ),
                }) as Field<string | boolean>)
              : (textField({
                  label,
                  ...(hint && { hint }),
                  value: initial === null ? "" : String(initial),
                  ...(input.type === "number" && { type: "number" as const }),
                }) as Field<string | boolean>);
      return { input, field };
    });
    formSlot.replaceChildren(
      ...(fields.length
        ? fields.map((f) => f.field.el)
        : [text({ text: t("workflowNoInputs"), tone: "subtle", size: "sm" })]),
    );
  };

  const workflowPick = select({
    label: t("workflow"),
    options: allowed.map((w) => ({ value: w.workflow, label: w.workflow })),
    value: workflow.workflow,
    onChange: (v) => {
      workflow = allowed.find((w) => w.workflow === v) ?? workflow;
      void drawInputs();
    },
  });
  const repoPick =
    repos.length > 1
      ? select({
          label: t("repository"),
          options: repos.map((r) => ({ value: r, label: r })),
          value: repo,
          onChange: (v) => {
            repo = v;
            void drawInputs();
          },
        })
      : null;

  const start = button({
    label: t("startNow"),
    icon: "play",
    variant: "primary",
    onClick: async () => {
      const missing = fields.find(
        (f) => f.input.required && f.field.value === "",
      );
      if (missing) {
        toast(t("inputRequired", { name: missing.input.name }), {
          tone: "warning",
        });
        missing.field.focus();
        return;
      }
      const inputs = Object.fromEntries(
        fields.map((f) => [f.input.name, String(f.field.value)]),
      );
      try {
        const as = await dispatchWorkflow(
          api,
          repo,
          workflow.workflow,
          branchField.value.trim(),
          inputs,
        );
        toast(
          as === "person"
            ? t("workflowStartedAs", { workflow: workflow.workflow })
            : t("workflowStartedApp", { workflow: workflow.workflow }),
          { tone: "success" },
        );
        host.close();
      } catch (error) {
        toast(
          error instanceof BranchError ? error.message : t("redeployFailed"),
          { tone: "danger" },
        );
      }
    },
  });
  const cancel = button({
    label: t("cancel"),
    variant: "secondary",
    onClick: () => host.close(),
  });
  const foot = row(
    text({
      text: me ? t("startsAs", { name: me.name }) : "",
      size: "xs",
      tone: "subtle",
    }),
    cancel,
    start,
  );
  foot.style.alignItems = "center";
  foot.style.justifyContent = "flex-end";
  foot.style.flexWrap = "wrap";
  (foot.firstElementChild as HTMLElement).style.marginRight = "auto";

  const body = stack(
    workflowPick.el,
    ...(repoPick ? [repoPick.el] : []),
    branchField.el,
    formSlot,
    foot,
  );
  body.style.gap = "0.875rem";
  body.style.padding = "0.25rem 0";
  el.replaceChildren(body);
  await drawInputs();
}
