Bring your GitHub work to the issues it's about. Barynt connects through its own GitHub App and reads what GitHub reports — **there's no server to run** — and this plugin shows it.

## On the board

Every card with a pull request shows a row: its number, where it stands (_Draft_, _Open_, _Changes requested_, _Approved_, _Merged_) and, while it's open, the checks of its branch. A whole board comes from one request to Barynt, never one to GitHub per card, and updates on its own when GitHub reports.

## In the issue

The **Development** panel shows:

- the branch — copy its name or open it on GitHub
- the pull requests with state, checks, size and reviewers
- the commits that name the issue

## Rules

Pick a status for _a pull request is opened_ and _a pull request is merged_ — say _In Review_ and _Done_. Barynt sets it as "GitHub (App)" and comments why, but only for issues the pull request really works on: the key in the branch name, or after _Fixes_, _Closes_ or _Resolves_.

## Actions

From an issue's menu, a card or the command palette: **Create branch** (named after your project's pattern, e.g. `ada/web-42-fix-login`), **Copy branch name** and **Open pull request**.

## Setup

1. Connect GitHub once for the workspace (or a project): install Barynt's GitHub App on your organization and pick its repositories.
2. Switch the plugin on in the project and tick the repositories it works with. No webhook to add.
3. Optional: each person adds a fine-grained token, for their login in branch names and to see reviewers.

Tokens are stored encrypted and only ever sent to `api.github.com`.
