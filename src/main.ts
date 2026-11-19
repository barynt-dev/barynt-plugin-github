import { Plugin } from "@barynt/plugin-sdk";
import { renderDevelopment } from "./panel";
import { pullRequestRow } from "./row";

// The plugin's part in Barynt's frames: it draws what Barynt keeps on the
// issues from GitHub's webhooks — the pull request's row on a card
// (BARY-228) and the "Development" panel in the issue (BARY-229).
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
  }
}
