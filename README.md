# GitHub for Barynt

Pull requests, branches, commits and checks on the issues they name, in
[Barynt](https://github.com/barynt-dev/barynt-web). A pull request whose
branch, title or description says `WEB-42` shows on issue WEB-42 — no
server to run: Barynt reads GitHub's webhooks itself and keeps what they
say on the issues; this plugin draws it.

> [!NOTE]
> Work in progress (BARY-219). Done so far: the manifest and the webhook.
> Next: the pull request's row on a card, the "Development" panel, creating
> a branch from an issue, and rules (merged → Done).

## Set it up in a project

1. **Admin → Plugins**: install GitHub, then release it for the workspace.
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
   *Contents* read and write, *Pull requests* and *Checks* read, for the
   team's repositories. It's only ever sent to `api.github.com`.

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
