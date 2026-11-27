import type {
  Badge,
  BadgeIcon,
  BadgeTone,
  RowPart,
  StepState,
} from "@barynt/plugin-sdk";
import { inOrder } from "./development";
import type { CheckState, Checks, Deployment, PullRequest } from "./entries";
import { sortEntries } from "./entries";
import { t } from "./i18n";
import {
  type DeployConfig,
  OTHER,
  partsOf,
  readConfig,
  type StationState,
  stations,
  worst,
} from "./stages";

// The pull request's row on a board card (BARY-228): its number, where it
// stands, its checks as bars and the overall result. With several, the
// newest open one and "+n".

/** How a pull request reads: a review that decides wins over "open". */
export function prLook(pr: PullRequest): {
  text: string;
  tone: BadgeTone;
  icon: BadgeIcon;
} {
  if (pr.state === "merged")
    return { text: t("merged"), tone: "primary", icon: "git-merge" };
  if (pr.state === "closed")
    return { text: t("closed"), tone: "danger", icon: "circle-x" };
  if (pr.state === "draft")
    return {
      text: t("draft"),
      tone: "neutral",
      icon: "git-pull-request",
    };
  if (pr.review === "changes_requested")
    return {
      text: t("changesRequested"),
      tone: "warning",
      icon: "git-pull-request",
    };
  if (pr.review === "approved")
    return { text: t("approved"), tone: "success", icon: "git-pull-request" };
  return { text: t("open"), tone: "success", icon: "git-pull-request" };
}

/** Which pull request the card shows: the newest still open, else the
 *  newest merged, else the newest at all. */
export function shownPullRequest(prs: PullRequest[]): PullRequest | null {
  const open = prs.filter((p) => p.state === "open" || p.state === "draft");
  return open[0] ?? prs.find((p) => p.state === "merged") ?? prs[0] ?? null;
}

/** The branch's checks as one signal on the right: failed, how many of
 *  all failed; else how many are done or passed — in their colour. */
function checkParts(checks: Checks | undefined): RowPart[] {
  if (!checks || checks.runs.length === 0) return [];
  const all = checks.runs.length;
  const count = (state: string) =>
    checks.runs.filter((r) => r.state === state).length;
  const look =
    checks.state === "failure"
      ? {
          icon: "circle-x" as const,
          tone: "danger" as const,
          n: count("failure"),
        }
      : checks.state === "pending"
        ? {
            icon: "timer" as const,
            tone: "info" as const,
            n: all - count("pending"),
          }
        : {
            icon: "circle-check" as const,
            tone: "success" as const,
            n: count("success"),
          };
  return [
    {
      type: "group",
      gap: 1,
      align: "center",
      children: [
        { type: "icon", icon: look.icon, tone: look.tone },
        {
          type: "text",
          text: `${look.n}/${all}`,
          size: "xs",
          mono: true,
          tone: look.tone,
          strong: true,
        },
      ],
    },
  ];
}

const STATION_STEP = {
  failure: "danger",
  waiting: "warning",
  running: "running",
  success: "success",
  idle: "pending",
} as const satisfies Record<StationState, StepState>;

/** Where it runs: a rocket and a bar per stage it reached, in the
 *  project's order — in the tone of the worst. Waiting for an approval is
 *  the one thing that gets a word: it needs someone. */
function deploymentParts(
  deployments: Deployment[],
  config: DeployConfig,
): RowPart[] {
  const reached = stations(deployments, config).filter(
    (s) => s.reached && s.stage.id !== OTHER,
  );
  if (reached.length === 0) return [];
  const states = reached.map((s) => worst(partsOf(s).map((p) => p.state)));
  const steps = states.slice(-5).map((st) => STATION_STEP[st]);
  const all = worst(reached.flatMap((s) => partsOf(s).map((p) => p.state)));
  const tone: BadgeTone =
    all === "failure"
      ? "danger"
      : all === "waiting"
        ? "warning"
        : all === "running"
          ? "info"
          : all === "success"
            ? "success"
            : "neutral";
  return [
    {
      type: "group",
      gap: 1,
      align: "center",
      children: [
        { type: "icon", icon: "rocket", tone },
        ...(all === "waiting"
          ? [
              {
                type: "text" as const,
                text: t("rowApproval"),
                tone: "warning" as const,
                size: "xs" as const,
                strong: true,
              },
            ]
          : []),
        { type: "steps", steps },
      ],
    },
  ];
}

/** Where its review stands, in a word: changes wanted, approved, or
 *  waiting — a draft says it's one. */
function reviewParts(pr: PullRequest): RowPart[] {
  if (pr.state === "draft")
    return [
      {
        type: "text",
        text: t("draft"),
        tone: "neutral",
        size: "xs",
        strong: true,
      },
    ];
  if (pr.review === "changes_requested")
    return [
      { type: "icon", icon: "pencil", tone: "warning" },
      {
        type: "text",
        text: t("rowChanges"),
        tone: "warning",
        size: "xs",
        strong: true,
      },
    ];
  if (pr.review === "approved")
    return [
      { type: "icon", icon: "check", tone: "success" },
      {
        type: "text",
        text: t("rowApproved"),
        tone: "success",
        size: "xs",
        strong: true,
      },
    ];
  return [
    { type: "icon", icon: "eye", tone: "neutral" },
    { type: "text", text: t("rowReview"), tone: "subtle", size: "xs" },
  ];
}

/** The row for one issue's entries — `null` without a pull request. */
export function pullRequestRow(
  raw: { key: string; value: unknown }[],
  config: DeployConfig = readConfig(undefined),
): Badge | null {
  const { pullRequests, checks, deployments } = sortEntries(raw);
  const pr = shownPullRequest(pullRequests);
  if (!pr) return deploymentRow(deployments, config);
  const look = prLook(pr);
  const open = pr.state === "open" || pr.state === "draft";
  const ofBranch = checks.find(
    (c) => c.repo === pr.repo && c.branch === pr.branch,
  );
  // Signals, not sentences: the number, the checks as "0/2", the review
  // in a word — open; merged or closed, how it ended.
  const parts: RowPart[] = [
    // Its icon and number close together, then what it's waiting on.
    {
      type: "group",
      gap: 1,
      align: "center",
      children: [
        { type: "icon", icon: look.icon, tone: look.tone },
        {
          type: "text",
          text: `#${pr.number}`,
          size: "xs",
          mono: true,
          tone: "subtle",
        },
      ],
    },
    { type: "divider" },
    ...(open
      ? reviewParts(pr)
      : [
          {
            type: "text" as const,
            text: look.text,
            tone: look.tone,
            size: "xs" as const,
            strong: true,
          },
        ]),
    { type: "spacer" },
    // The checks on the right — how many failed of how many — then
    // where it runs.
    ...(open ? checkParts(ofBranch) : []),
    ...(open && ofBranch?.runs.length && deployments.length
      ? [{ type: "divider" as const }]
      : []),
    ...deploymentParts(deployments, config),
  ];
  return {
    badge: "pull-request",
    kind: "row",
    // A click opens the issue at this panel (BARY-229).
    panel: "development",
    // …at its pull requests, unfolded — or, merged, where it runs.
    section: !open && deployments.length ? "deployments" : "pull-requests",
    text: `#${pr.number} ${look.text}`,
    tone: look.tone,
    tooltip: `${pr.repo}#${pr.number}: ${pr.title}`.slice(0, 120),
    parts,
  };
}

/** Without a pull request, deployed all the same (a commit of `main`
 *  naming it): just where it runs. */
function deploymentRow(
  deployments: Deployment[],
  config: DeployConfig,
): Badge | null {
  const parts = deploymentParts(deployments, config);
  if (parts.length === 0) return null;
  const latest = inOrder(deployments).at(-1);
  return {
    badge: "pull-request",
    kind: "row",
    panel: "development",
    section: "deployments",
    text: t("deployments"),
    tone: "neutral",
    tooltip: latest
      ? `${latest.environment}: ${latest.state}`
      : t("deployments"),
    parts: [
      { type: "text", text: t("deployments"), size: "xs", tone: "subtle" },
      { type: "spacer" },
      ...parts,
    ],
  };
}
