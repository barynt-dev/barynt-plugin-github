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
    return { text: t("draft"), tone: "neutral", icon: "git-pull-request" };
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

const STEP: Record<CheckState, StepState> = {
  success: "success",
  failure: "danger",
  pending: "running",
  neutral: "pending",
};
const STATUS = {
  success: "success",
  failure: "danger",
  pending: "pending",
} as const;

/** At most this many bars; past that the overall result says enough. */
export const MAX_BARS = 5;

/** The checks of the pull request's branch, as bars and one result. */
function checkParts(checks: Checks | undefined): RowPart[] {
  if (!checks || checks.runs.length === 0) return [];
  const parts: RowPart[] = [
    {
      type: "steps",
      steps: checks.runs.slice(0, MAX_BARS).map((r) => STEP[r.state]),
    },
  ];
  if (checks.state !== "neutral")
    parts.push({ type: "status", status: STATUS[checks.state] });
  return parts;
}

/** The row for one issue's entries — `null` without a pull request. */
export function pullRequestRow(
  raw: { key: string; value: unknown }[],
): Badge | null {
  const { pullRequests, checks } = sortEntries(raw);
  const pr = shownPullRequest(pullRequests);
  if (!pr) return null;
  const look = prLook(pr);
  const others = pullRequests.length - 1;
  const ofBranch = checks.find(
    (c) => c.repo === pr.repo && c.branch === pr.branch,
  );
  const parts: RowPart[] = [
    { type: "icon", icon: look.icon, tone: look.tone },
    { type: "text", text: `#${pr.number}`, mono: true, tone: "subtle" },
    { type: "text", text: look.text, tone: look.tone, strong: true },
    { type: "spacer" },
    ...(pr.state === "open" || pr.state === "draft"
      ? checkParts(ofBranch)
      : []),
    // A chip, not text: it keeps its width when the state's text shrinks.
    ...(others > 0 ? [{ type: "chip" as const, text: `+${others}` }] : []),
  ];
  return {
    badge: "pull-request",
    kind: "row",
    // A click opens the issue at this panel (BARY-229).
    panel: "development",
    text: `#${pr.number} ${look.text}`,
    tone: look.tone,
    tooltip: `${pr.repo}#${pr.number}: ${pr.title}`.slice(0, 120),
    parts,
  };
}
