import { BaryntError, type Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  card,
  copyField,
  diffStat,
  emptyState,
  notice,
  row,
  sectionHeader,
  stack,
  stepList,
  text,
  user,
} from "@barynt/plugin-sdk/ui";
import { COMMITS_SHOWN, development, latestReviews } from "./development";
import type { PullRequest } from "./entries";
import { prLook } from "./row";

// The "Development" panel in an issue's sidebar (BARY-229): its branch,
// its pull requests with their checks, size and reviews, and the commits
// that name it. What Barynt keeps comes first; who reviewed comes live from
// GitHub, with the person's own token.

type Api = Plugin["api"];

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 60 / 24)} d ago`;
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
        text: `GitHub answered ${res.status} for the reviews.`,
        tone: "subtle",
        size: "sm",
      });
    const latest = latestReviews(res.json());
    if (latest.length === 0)
      return text({ text: "No reviews yet.", tone: "subtle", size: "sm" });
    return stack(
      ...latest.map((r) =>
        user({
          name: r.login,
          meta: r.state === "approved" ? "Approved" : "Changes requested",
        }),
      ),
    );
  } catch (error) {
    if (error instanceof BaryntError && error.code === "credential_missing")
      return notice({
        text: "Keep your GitHub token under your settings → Plugins → GitHub to see who reviewed.",
        tone: "info",
      });
    return text({
      text: "Reviews couldn't be loaded.",
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
  who.append(text({ text: "Loading reviews…", tone: "subtle", size: "sm" }));
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
              label: "Open on GitHub",
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

  parts.push(sectionHeader({ title: "Branch", icon: "git-branch" }));
  if (dev.branches.length === 0)
    parts.push(
      text({
        text: "No branch names this issue yet. Put its key in a branch's name and GitHub's webhook links it.",
        tone: "subtle",
        size: "sm",
      }),
    );
  for (const b of dev.branches)
    parts.push(
      copyField({
        value: b.name,
        icon: "git-branch",
        label: "Copy branch name",
        ...(b.url && { href: b.url }),
      }),
    );

  if (dev.pullRequests.length > 0) {
    parts.push(
      sectionHeader({
        title: "Pull requests",
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
        title: "Commits",
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
                label: `Show all ${dev.commits.length}`,
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

  if (
    dev.branches.length === 0 &&
    dev.pullRequests.length === 0 &&
    dev.commits.length === 0
  ) {
    el.replaceChildren(
      emptyState({
        title: "Nothing from GitHub yet",
        text: "Branches, pull requests and commits that name this issue show here.",
        icon: "git-branch",
      }),
    );
    return;
  }
  const panel = stack(...parts);
  panel.style.padding = "0.75rem";
  el.replaceChildren(panel);
}
