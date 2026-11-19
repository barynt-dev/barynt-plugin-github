import { Plugin } from "@barynt/plugin-sdk";
import { pullRequestRow } from "./row";

// The plugin's part in Barynt's frames: it draws what Barynt keeps on the
// issues from GitHub's webhooks. The pull request's row on a card comes
// first (BARY-228); the "Development" panel and the actions follow.
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
  }
}
