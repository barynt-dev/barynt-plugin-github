import {
  type DownloadFile,
  type ModalOptions,
  Plugin,
} from "@barynt/plugin-sdk";
import {
  copyBranchNameAction,
  createBranchAction,
  createPullRequestAction,
  deleteBranchAction,
  openPullRequestAction,
  renameBranchAction,
  runWorkflowAction,
} from "./actions";
import {
  configOf,
  type DeploymentView,
  type LogWindow,
  renderDeployment,
  renderFullLog,
  renderStage,
  type StageView,
} from "./deployments";
import { t } from "./i18n";
import { renderDevelopment } from "./panel";
import { pullRequestRow } from "./row";
import { renderDeploySettings } from "./settingsPage";

// The plugin's part in Barynt's frames: it draws what Barynt keeps on the
// issues from GitHub's webhooks — the pull request's row on a card
// (BARY-228), the "Development" panel in the issue (BARY-229) — its
// and its actions on an issue (BARY-230). Its settings are Barynt's form.
export default class GitHub extends Plugin {
  onload() {
    // One call for the whole batch of cards, never one to GitHub per card.
    this.registerBadges({
      provide: async (issues) => {
        const [data, config] = await Promise.all([
          this.api.issueData.list(issues.map((i) => i.id)),
          configOf(this.api),
        ]);
        return Object.fromEntries(
          issues.flatMap((issue) => {
            const row = pullRequestRow(data[issue.id] ?? [], config);
            return row ? [[issue.id, [row]]] : [];
          }),
        );
      },
    });
    // Below Barynt's settings form, in a project: the deployments' stages,
    // environments, workflows and patterns.
    let saveDeploy: (() => Promise<void>) | null = null;
    this.registerSettings({
      render: async (el) => {
        if (!this.context.projectId) return;
        saveDeploy = await renderDeploySettings(this.api, el, {
          unsaved: (on) => this.setUnsaved(on),
        });
      },
      save: async () => {
        await saveDeploy?.();
      },
    });
    this.registerIssuePanel({
      id: "development",
      render: async (el, { issueId }) => {
        if (!issueId) return;
        // A window the panel opened: an environment's details, or a
        // stage's parts.
        const modal = this.context.modal;
        const host = {
          close: () => this.closeModal(),
          openSettings: (level: "personal" | "project") =>
            this.openSettings(level),
          openModal: (options: ModalOptions) => this.openModal(options),
          download: (file: DownloadFile) => this.download(file),
        };
        if (modal?.view === "log") {
          await renderFullLog(this.api, el, modal.data as LogWindow, host);
          return;
        }
        if (modal?.view === "deployment") {
          await renderDeployment(
            this.api,
            el,
            issueId,
            modal.data as DeploymentView,
            host,
          );
          return;
        }
        if (modal?.view === "stage") {
          await renderStage(
            this.api,
            el,
            issueId,
            modal.data as StageView,
            host,
          );
          return;
        }
        await renderDevelopment(
          this.api,
          el,
          issueId,
          (id, choice) =>
            this.runAction(id, choice === undefined ? {} : { choice }),
          (level) => this.openSettings(level),
          this.context.focus,
          (options) => this.openModal(options),
        );
      },
    });
    const onIssue =
      (
        run: (
          issueId: string,
          choice?: string,
          values?: Record<string, string>,
        ) => Promise<object>,
      ) =>
      async ({
        issueId,
        choice,
        values,
      }: {
        issueId: string | null;
        choice?: string;
        values?: Record<string, string>;
      }) =>
        issueId ? run(issueId, choice, values) : { message: t("pickIssue") };
    this.registerAction({
      id: "create-branch",
      run: onIssue((id, choice, values) =>
        createBranchAction(this.api, id, choice, values),
      ),
    });
    // From the panel only (`"where": []`).
    this.registerAction({
      id: "create-pull-request",
      run: onIssue((id, choice) =>
        createPullRequestAction(this.api, id, choice),
      ),
    });
    this.registerAction({
      id: "rename-branch",
      run: onIssue((id, choice, values) =>
        renameBranchAction(this.api, id, choice, values),
      ),
    });
    this.registerAction({
      id: "delete-branch",
      run: onIssue((id, choice, values) =>
        deleteBranchAction(this.api, id, choice, values),
      ),
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
