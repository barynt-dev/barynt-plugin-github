import {
  BaryntError,
  type ModalOptions,
  type Plugin,
} from "@barynt/plugin-sdk";
import {
  badge,
  button,
  card,
  copyField,
  diffStat,
  link,
  list,
  notice,
  row,
  type StepState,
  sectionHeader,
  skeleton,
  stack,
  stageBar,
  stepList,
  text,
  userNote,
} from "@barynt/plugin-sdk/ui";
import { branchChoice, runWorkflowAction } from "./actions";
import { deploymentParts } from "./deployments";
import {
  type BranchRow,
  COMMITS_SHOWN,
  development,
  lastComment,
  latestReviews,
  type NextStep,
  prProgress,
  reviewer,
  withoutIssueKey,
} from "./development";
import type { PullRequest } from "./entries";
import { branchSettings, canReach, proposedName } from "./github";
import { t } from "./i18n";
import { prLook } from "./row";
import { ago } from "./time";

// The "Development" panel in an issue's sidebar (BARY-229): its branch,
// its pull requests with their checks, size and reviews, and the commits
// that name it. What Barynt keeps comes first; who reviewed comes live from
// GitHub, with the person's own token.

type Api = Plugin["api"];

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
    // The newest comment, under the one who wrote it (a click shows all of
    // it) — someone who only commented gets a line of their own. The rest
    // are on GitHub.
    const said = lastComment(res.json());
    if (latest.length === 0 && !said)
      return text({ text: t("noReviews"), tone: "subtle", size: "sm" });
    const note = (login: string, state: string | null) => {
      const who = reviewer(login);
      return userNote({
        name: who.name,
        ...(who.bot && { tag: t("bot") }),
        ...(state === "approved" && {
          status: { text: t("approved"), tone: "success" as const },
        }),
        ...(state === "changes_requested" && {
          status: { text: t("changesRequested"), tone: "warning" as const },
        }),
        ...(said?.login === login && { text: said.text }),
      });
    };
    const notes = latest.map((r) => note(r.login, r.state));
    if (said && !latest.some((r) => r.login === said.login))
      notes.push(note(said.login, null));
    const more =
      said && pr.url && said.count > 1
        ? [
            link({
              text: t("moreComments", { count: said.count }),
              href: pr.url,
            }),
          ]
        : [];
    return stack(...notes, ...more);
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

const NEXT_TONE = {
  checksFailed: "danger",
  changesRequested: "warning",
  draft: "neutral",
  checksRunning: "info",
  awaitingReview: "info",
  readyToMerge: "success",
} as const;

/** The next thing to do about it, in words. */
function nextText(next: NextStep): string {
  if (next.kind === "checksFailed")
    return t("nextChecksFailed", { count: next.count });
  return t(`next_${next.kind}`);
}

/**
 * A pull request as a card: its number and title, then — while it's open —
 * its way to the merge as stations and the next thing to do, with a link
 * there. Checks and reviews one by one fold away under "Details"; the
 * reviews load from GitHub the first time it opens.
 */
function pullRequestCard(
  api: Api,
  pr: PullRequest,
  steps: { label: string; state: StepState }[],
  withRepo: boolean,
): HTMLElement {
  const open = pr.state === "open" || pr.state === "draft";
  const look = prLook(pr);
  const title = `${withRepo ? pr.repo : ""}#${pr.number} ${withoutIssueKey(pr.title)}`;
  const progress = open ? prProgress(pr, steps) : null;
  const who = stack();
  let loaded = false;
  const details: HTMLElement[] = [
    text({
      text: [pr.author, ago(pr.at)].filter(Boolean).join(" · "),
      tone: "subtle",
      size: "xs",
    }),
    ...(steps.length > 0
      ? [
          text({
            text: t("checksTitle"),
            size: "xs",
            weight: "semibold",
            tone: "subtle",
          }),
          stepList({ steps }),
        ]
      : []),
    ...(open
      ? [
          text({
            text: t("reviewsTitle"),
            size: "xs",
            weight: "semibold",
            tone: "subtle",
          }),
          who,
        ]
      : []),
  ];
  const where = (next: NextStep) =>
    pr.url && next.kind === "checksFailed" ? `${pr.url}/checks` : pr.url;
  return card({
    title,
    compact: true,
    ...(pr.url && {
      actions: [
        button({
          label: t("openOnGitHub"),
          icon: "external-link",
          iconOnly: true,
          size: "sm",
          variant: "ghost",
          onClick: () => {
            window.open(pr.url as string, "_blank", "noopener");
          },
        }),
      ],
    }),
    children: progress
      ? [
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
            ...(where(progress.next) && {
              action: link({
                text:
                  progress.next.kind === "readyToMerge" ||
                  progress.next.kind === "draft"
                    ? t("onGitHub")
                    : t("look"),
                href: where(progress.next) as string,
              }),
            }),
          }),
        ]
      : // Merged or closed: where it ended, no way ahead.
        [row(badge({ text: look.text, tone: look.tone }))],
    more: {
      label: t("details"),
      ...(pr.additions !== null &&
        pr.deletions !== null && {
          aside: [diffStat({ added: pr.additions, removed: pr.deletions })],
        }),
      content: details,
      onToggle: (isOpen) => {
        if (!isOpen || loaded || !open) return;
        loaded = true;
        who.replaceChildren(
          text({ text: t("loadingReviews"), tone: "subtle", size: "sm" }),
        );
        void reviews(api, pr).then((el) => who.replaceChildren(el));
      },
    },
  });
}

/** Draws the panel for an issue into `el`. */
/** Where a person's Branch section remembers being folded away. */
const FOLD_BRANCH = "fold:branch";

/** Where a person's Pull Requests section remembers being folded away. */
const FOLD_PR = "fold:pr";
/** Where a person's Commits section remembers being folded away. */
const FOLD_COMMITS = "fold:commits";
/** Pull requests shown before "more". */
const PRS_SHOWN = 2;

/**
 * What doesn't show at once, behind a quiet button — like the commits'
 * "Show all" — sorted inside into what's still going on and what's done,
 * with a button under them that folds them away again.
 */
function moreBox(
  label: string,
  groups: { title: string; items: HTMLElement[]; dim?: boolean }[],
): HTMLElement {
  const filled = groups.filter((g) => g.items.length > 0);
  const rest = filled.flatMap((g) => {
    if (g.dim) for (const c of g.items) c.style.opacity = "0.6";
    if (filled.length < 2) return g.items;
    const head = text({
      text: g.title,
      tone: "subtle",
      size: "xs",
      weight: "medium",
    });
    return [stack(head, ...g.items)];
  });
  const box = stack();
  const show = (open: boolean): void => {
    box.replaceChildren(
      ...(open ? rest : []),
      button({
        label: open ? t("showLess") : label,
        size: "sm",
        variant: "ghost",
        onClick: () => show(!open),
      }),
    );
  };
  show(false);
  return box;
}

/**
 * What the panel shows with nothing linked: where to start. Without a
 * repository, the project's settings; without a way into GitHub, the
 * person's; else "Create branch" — and the name it would get, to copy
 * for whoever makes it locally (it shows up here once pushed).
 */
async function startHere(
  api: Api,
  issueId: string,
  run: (actionId: string) => void,
  openSettings: (level: "personal" | "project") => void,
): Promise<HTMLElement> {
  const settings = await branchSettings(api).catch(() => null);
  const repo = settings?.repositories[0];
  // Quiet: a line, what to do, nothing more.
  const box = (
    body: string,
    action: HTMLElement,
    extra: HTMLElement[] = [],
  ) => {
    const node = stack(
      text({ text: body, tone: "subtle", size: "sm" }),
      row(action),
      ...extra,
    );
    node.style.padding = "0.25rem 0 0.5rem";
    node.style.gap = "0.5rem";
    return node;
  };
  if (!settings || !repo)
    return box(
      t("noRepoText"),
      button({
        label: t("connectRepo"),
        icon: "settings",
        size: "sm",
        variant: "secondary",
        onClick: () => openSettings("project"),
      }),
    );
  if (!(await canReach(api, repo)))
    return box(
      t("noAccessText"),
      button({
        label: t("connectGitHub"),
        icon: "link",
        size: "sm",
        variant: "secondary",
        onClick: () => openSettings("personal"),
      }),
    );
  const name = await proposedName(api, issueId, settings.pattern).catch(
    () => null,
  );
  return box(
    t("startText"),
    button({
      label: t("createBranch"),
      icon: "plus",
      size: "sm",
      variant: "secondary",
      onClick: () => run("create-branch"),
    }),
    name
      ? [
          text({ text: t("orLocally"), tone: "subtle", size: "xs" }),
          copyField({
            value: name,
            icon: "git-branch",
            label: t("copyBranchName"),
          }),
        ]
      : [],
  );
}

export async function renderDevelopment(
  api: Api,
  el: HTMLElement,
  issueId: string,
  /** Starts one of the plugin's actions for the issue — Barynt shows its
   *  windows and answers (`Plugin.runAction`). */
  run: (actionId: string, choice?: string) => void,
  /** Opens the plugin's settings in Barynt (`Plugin.openSettings`). */
  openSettings: (level: "personal" | "project") => void = () => {},
  /** The part a board's badge asked for (`context.focus`) — unfolded,
   *  whatever was kept. */
  focus?: string,
  /** Opens a window of Barynt's with a view of the plugin
   *  (`Plugin.openModal`) — an environment's details. */
  openModal: (options: ModalOptions) => void = () => {},
): Promise<void> {
  // While GitHub's state loads: a skeleton where it'll be.
  if (!el.firstChild) {
    const loading = skeleton({ lines: 3 });
    loading.style.padding = "0.5rem 0";
    el.replaceChildren(loading);
  }
  const data = await api.issueData.list([issueId]);
  const dev = development(data[issueId] ?? []);
  const parts: HTMLElement[] = [];

  // Nothing linked yet — no branch, pull request or commit: one way to
  // start instead of three empty sections.
  if (
    !dev.branchView.main &&
    dev.branchView.others.length === 0 &&
    dev.branchView.done.length === 0 &&
    dev.pullRequests.length === 0 &&
    dev.commits.length === 0 &&
    dev.deployments.length === 0
  ) {
    el.replaceChildren(await startHere(api, issueId, run, openSettings));
    return;
  }

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
  if (hidden > 0)
    branchParts.push(
      moreBox(
        main
          ? t("moreBranches", { count: hidden })
          : t("doneBranches", { count: hidden }),
        [
          { title: t("activeBranches"), items: others.map(branchRow) },
          {
            title: t("finishedBranches"),
            items: done.map(branchRow),
            dim: true,
          },
        ],
      ),
    );
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
  // GitHub's page to create one (the `create-pull-request` action). The
  // open ones first; past the first two, the rest behind "more", sorted
  // into open and done (merged, closed). The section folds away.
  // Folded by default — open where someone opened it, or where a badge
  // asked for it.
  const prOpen =
    focus === "pull-requests" ||
    (await api.storage.personal.get<boolean>(FOLD_PR).catch(() => null)) ===
      true;
  const isActive = (p: { pr: PullRequest }) =>
    p.pr.state === "open" || p.pr.state === "draft";
  const activePrs = dev.pullRequests.filter(isActive);
  const donePrs = dev.pullRequests.filter((p) => !isActive(p));
  // The repository only where there's more than one.
  const withRepo = new Set(dev.pullRequests.map((p) => p.pr.repo)).size > 1;
  const prCard = ({ pr, steps }: (typeof dev.pullRequests)[number]) =>
    pullRequestCard(api, pr, steps, withRepo);
  // Merged or closed: a small card — number, title, how it ended and a
  // way to GitHub; no way ahead, no details.
  const doneList = (prs: typeof dev.pullRequests): HTMLElement[] =>
    prs.map(({ pr }) => {
      const look = prLook(pr);
      return card({
        title: `${withRepo ? pr.repo : ""}#${pr.number} ${withoutIssueKey(pr.title)}`,
        compact: true,
        actions: [
          badge({ text: look.text, tone: look.tone }),
          ...(pr.url
            ? [
                button({
                  label: t("openOnGitHub"),
                  icon: "external-link",
                  iconOnly: true,
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
    });
  const shown = [...activePrs, ...donePrs].slice(0, PRS_SHOWN);
  const shownDone = shown.filter((p) => !isActive(p));
  const prParts = [
    ...shown.filter(isActive).map(prCard),
    ...doneList(shownDone).map((el) => {
      el.style.opacity = "0.6";
      return el;
    }),
  ];
  const morePrs = dev.pullRequests.length - shown.length;
  if (morePrs > 0)
    prParts.push(
      moreBox(t("morePullRequests", { count: morePrs }), [
        {
          title: t("activePullRequests"),
          items: activePrs.filter((p) => !shown.includes(p)).map(prCard),
        },
        {
          title: t("finishedPullRequests"),
          items: doneList(donePrs.filter((p) => !shown.includes(p))),
          dim: true,
        },
      ]),
    );
  parts.push(
    sectionHeader({
      size: "sm",
      title: t("pullRequests"),
      icon: "git-pull-request",
      count: activePrs.length,
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
      fold: {
        content: prParts,
        open: prOpen,
        onToggle: (open) => {
          void api.storage.personal.set(FOLD_PR, open).catch(() => {});
        },
      },
    }),
  );

  // One line each — its first, the rest cut off — that opens the commit
  // on GitHub. The section folds away like the others.
  // Folded by default, like the pull requests.
  const commitsOpen =
    (await api.storage.personal
      .get<boolean>(FOLD_COMMITS)
      .catch(() => null)) === true;
  const commitParts: HTMLElement[] = [];
  if (dev.commits.length > 0) {
    const box = stack();
    const show = (count: number): void => {
      box.replaceChildren(
        list({
          items: dev.commits.slice(0, count).map((c) => ({
            title: c.message.split("\n")[0] ?? c.message,
            ...(c.url && { href: c.url }),
            lead: [
              text({
                text: c.sha,
                mono: true,
                size: "xs",
                tone: "primary",
                inline: true,
              }),
            ],
          })),
        }),
        ...(count < dev.commits.length
          ? [
              button({
                label: t("showAll", { count: dev.commits.length }),
                size: "sm",
                variant: "ghost",
                onClick: () => show(dev.commits.length),
              }),
            ]
          : dev.commits.length > COMMITS_SHOWN
            ? [
                button({
                  label: t("showLess"),
                  size: "sm",
                  variant: "ghost",
                  onClick: () => show(COMMITS_SHOWN),
                }),
              ]
            : []),
      );
    };
    show(COMMITS_SHOWN);
    commitParts.push(box);
  }
  parts.push(
    sectionHeader({
      size: "sm",
      title: t("commits"),
      icon: "git-commit-horizontal",
      count: dev.commits.length,
      fold: {
        content: commitParts,
        open: commitsOpen,
        onToggle: (open) => {
          void api.storage.personal.set(FOLD_COMMITS, open).catch(() => {});
        },
      },
    }),
  );

  // Where it runs: its environments, production last (BARY-238).
  parts.push(
    ...(await deploymentParts(
      api,
      dev.deployments,
      dev.commits,
      openModal,
      () =>
        void renderDevelopment(
          api,
          el,
          issueId,
          run,
          openSettings,
          focus,
          openModal,
        ),
    )),
  );

  // In the issue's sidebar, without a box: edge to edge with its fields,
  // the quiet heads a little closer to what they head.
  const panel = stack(...parts);
  panel.style.padding = "0.25rem 0 0.5rem";
  panel.style.gap = "0.625rem";
  el.replaceChildren(panel);
}
