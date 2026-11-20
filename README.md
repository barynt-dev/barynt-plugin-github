# GitHub for Barynt

Pull requests, branches, commits and checks on the issues they name, in
[Barynt](https://github.com/barynt-dev/barynt-web). A pull request whose
branch, title or description says `WEB-42` shows on issue WEB-42 — no
server to run: Barynt reads GitHub's webhooks itself and keeps what they
say on the issues; this plugin draws it.

> [!NOTE]
> **0.1.0-beta.1** — the first pre-release. It needs Barynt 1.1.0 or later,
> the first version with plugins.

## On the board

A card whose issue has a pull request shows a row: its number, where it
stands (_Draft_, _Open_, _Changes requested_, _Approved_, _Merged_,
_Closed_), and while it's open, the checks of its branch as bars with the
overall result. With several pull requests, the newest open one and "+n".
The rows of a whole board come from one request to Barynt, never one to
GitHub per card, and change on their own when GitHub reports.

## Set it up in a project

1. **Admin → Plugins**: install GitHub from the official directory
   ([barynt-plugin-store](https://github.com/barynt-dev/barynt-plugin-store)),
   then release it for the workspace.
2. **Project settings → Plugins → GitHub**: confirm what it may do and
   switch it on.
3. The card **Webhooks from other services** shows an address and a
   secret. In GitHub, open the repository (or the organization) →
   **Settings → Webhooks → Add webhook**:
   - **Payload URL**: the address
   - **Content type**: `application/json`
   - **Secret**: the secret
   - **Let me select individual events**: Branch or tag creation, Branch or
     tag deletion, Check runs, Check suites, Pull requests, Pull request
     reviews, Pushes
4. Each person who wants to create branches from Barynt adds a
   **fine-grained token** under their personal settings → Plugins → GitHub:
   _Contents_ read and write, _Pull requests_ and _Checks_ read, for the
   team's repositories. It's only ever sent to `api.github.com`.

## Rules

Under the webhook in the plugin's settings, pick a status for each rule,
or leave it off:

- **When a pull request is opened** — e.g. _In Review_
- **When a pull request is merged** — e.g. _Done_

Barynt sets it as "GitHub (App)" and comments why — only for an issue the
pull request works on: its key in the branch's name, or after _Fixes_,
_Closes_ or _Resolves_ in the title or description.

## In the issue

The **Development** panel in the issue's sidebar shows its branch (copy
the name, open it on GitHub), its pull requests with their state, checks,
size and — with your own GitHub token — who reviewed, and the commits that
name it (five, then "Show all"). A click on a card's pull request row opens
the issue there.

## Actions

In an issue's menu ("…"), a card's quick actions and the command palette:

- **Create branch** — in the project's first repository, from its default
  branch, named after the pattern in the settings (`{user}/{key}-{title}`
  by default: `ada/web-42-keep-the-cookie`); a taken name gets `-2`. With
  your own token, so you're its author on GitHub. As the project set it,
  the issue is then assigned to you and moved to a status. The panel has
  the same button while the issue has no branch.
- **Copy branch name** — the issue's branch, or the name it would get.
- **Open pull request** — its open pull request, or GitHub's page to open
  one for its branch, the title starting with the issue's key.

## Settings

Under **Project settings → Plugins → GitHub**: the repositories (`owner/repo`,
one per line), the branch name's pattern, whether creating a branch assigns
the issue, and which status it gets then.

Below the form, **Repositories on GitHub** checks each saved repository
with your token: _Ready_, _Read only_ (no branches), _Not found for your
token_, or that GitHub doesn't accept the token — and shows what a
branch's name will look like. When the webhook last called is on Barynt's
card below it.

## How issues are found

Barynt looks for the project's issue keys in a pull request's branch,
title and description, in commit messages and branch names: `WEB-42`,
`web-42-fix-login` and `feature/WEB_42` all name WEB-42. Only keys of the
project the plugin is on in count.

## Work on it

The SDK comes from a Barynt checkout next to this folder
(`../barynt/packages/plugin-sdk`):

```bash
(cd ../barynt/packages/plugin-sdk && bun install && bun run build)
bun install
bun run dev        # builds dist/ on every change
bun run test
bun run lint && bun run typecheck
```

In your local Barynt's `.env`: `PLUGIN_DEV_DIRS="/path/to/barynt-plugin-github"`,
then install it under **Admin → Plugins → Sources → Local plugins**.

## Release

`bun run release` builds, copies the files to `release/<version>/`, prints
the release hash and adds the version to `release/plugins.json`. CI does
the same for a pushed tag that matches the manifest's version and creates
the GitHub release.
