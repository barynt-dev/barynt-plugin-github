import type {
  Badge,
  BadgeIcon,
  BadgeTone,
  RowPart,
  StepState,
} from "@barynt/plugin-sdk";
import type { CheckState, Checks, PullRequest } from "./entries";
import { sortEntries } from "./entries";
import { t } from "./i18n";

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
): Badge | null {
  const { pullRequests, checks } = sortEntries(raw);
  const pr = shownPullRequest(pullRequests);
  if (!pr) return null;
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
    // The checks on the right — how many failed of how many.
    ...(open ? checkParts(ofBranch) : []),
  ];
  return {
    badge: "pull-request",
    kind: "row",
    // A click opens the issue at this panel (BARY-229).
    panel: "development",
    // …at its pull requests, unfolded.
    section: "pull-requests",
    text: `#${pr.number} ${look.text}`,
    tone: look.tone,
    tooltip: `${pr.repo}#${pr.number}: ${pr.title}`.slice(0, 120),
    parts,
  };
}
