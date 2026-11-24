import { Plugin } from "@barynt/plugin-sdk";
import {
  copyBranchNameAction,
  createBranchAction,
  openPullRequestAction,
  runWorkflowAction,
} from "./actions";
import { t } from "./i18n";
import { renderDevelopment } from "./panel";
import { pullRequestRow } from "./row";

// The plugin's part in Barynt's frames: it draws what Barynt keeps on the
// issues from GitHub's webhooks — the pull request's row on a card
// (BARY-228), the "Development" panel in the issue (BARY-229) — its
// and its actions on an issue (BARY-230). Its settings are Barynt's form.
export default class GitHub extends Plugin {
  onload() {
    // One call for the whole batch of cards, never one to GitHub per card.
    this.registerBadges({
      provide: async (issues) => {
        const data = await this.api.issueData.list(issues.map((i) => i.id));
        return Object.fromEntries(
          issues.flatMap((issue) => {
            const row = pullRequestRow(data[issue.id] ?? []);
            return row ? [[issue.id, [row]]] : [];
          }),
        );
      },
    });
    this.registerIssuePanel({
      id: "development",
      render: async (el, { issueId }) => {
        if (issueId) await renderDevelopment(this.api, el, issueId);
      },
    });
    const onIssue =
      (run: (issueId: string) => Promise<object>) =>
      async ({ issueId }: { issueId: string | null }) =>
        issueId ? run(issueId) : { message: t("pickIssue") };
    this.registerAction({
      id: "create-branch",
      run: onIssue((id) => createBranchAction(this.api, id)),
    });
    this.registerAction({
      id: "copy-branch-name",
      run: onIssue((id) => copyBranchNameAction(this.api, id)),
    });
    this.registerAction({
      id: "open-pull-request",
      run: onIssue((id) => openPullRequestAction(this.api, id)),
    });
    this.registerAction({
      id: "run-workflow",
      run: onIssue((id) => runWorkflowAction(this.api, id)),
    });
  }
}
