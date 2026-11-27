import type { Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  heading,
  type Option,
  row,
  sectionHeader,
  select,
  skeleton,
  stack,
  table,
  text,
  textField,
  toggle,
} from "@barynt/plugin-sdk/ui";
import { recentEnvironments, repoWorkflows, workflowInputs } from "./github";
import { t } from "./i18n";
import {
  type DeployConfig,
  defaultStages,
  OTHER,
  place,
  readConfig,
  recognize,
  type WorkflowSetting,
  writeConfig,
} from "./stages";
import { ago } from "./time";

// The project's settings for deployments (BARY-238), below Barynt's form:
// the stages in order, which is live; recognizing environments by name
// (on by default), and each one set by hand; workflows that count as a
// deployment; patterns for environments still to come. Saved with
// Barynt's Save button into the `deployments` setting.

type Api = Plugin["api"];

/** How long since, or that it's been a while — over 30 days: orange. */
const OLD_DAYS = 30;

export interface SettingsHost {
  unsaved(on: boolean): void;
}

/** Draws the section and gives back what saves it. */
export async function renderDeploySettings(
  api: Api,
  el: HTMLElement,
  host: SettingsHost,
): Promise<() => Promise<void>> {
  el.replaceChildren(skeleton({ lines: 4 }));
  const values = (await api.settings.get().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const config = readConfig(values.deployments);
  const repos = Array.isArray(values.repositories)
    ? (values.repositories as string[])
    : [];
  const [envs, workflows] = await Promise.all([
    Promise.all(
      repos.map((r) => recentEnvironments(api, r).catch(() => [])),
    ).then((all) => {
      const seen = new Map<
        string,
        { environment: string; production: boolean; at: string | null }
      >();
      for (const e of all.flat())
        if (!seen.has(e.environment)) seen.set(e.environment, e);
      // What's set by hand but not deployed to lately stays listed.
      for (const name of Object.keys(config.envs))
        if (!seen.has(name))
          seen.set(name, { environment: name, production: false, at: null });
      return [...seen.values()].sort((a, b) =>
        a.environment.localeCompare(b.environment),
      );
    }),
    Promise.all(
      repos.map(async (repo) =>
        (await repoWorkflows(api, repo).catch(() => [])).map((w) => ({
          ...w,
          repo,
        })),
      ),
    ).then(async (all) => {
      const seen = new Map<
        string,
        { file: string; name: string; updatedAt: string | null; repo: string }
      >();
      for (const w of all.flat()) if (!seen.has(w.file)) seen.set(w.file, w);
      const list = [...seen.values()].sort((a, b) =>
        a.file.localeCompare(b.file),
      );
      // What each takes when started by hand — `null`: it can't be.
      return Promise.all(
        list.slice(0, 30).map(async (w) => ({
          ...w,
          inputs: await workflowInputs(api, w.repo, w.file).catch(() => null),
        })),
      );
    }),
  ]);
  const known = new Set(config.known);
  const firstTime = config.known.length === 0;
  const changed = () => host.unsaved(true);

  const draw = () => {
    const stageOptions = (withOther: boolean): Option[] => [
      ...config.stages.map((s) => ({ value: s.id, label: s.name })),
      ...(withOther ? [{ value: OTHER, label: t("stageOther") }] : []),
    ];

    // ─── Stages ──────────────────────────────────────────────────────────
    const stageRows = config.stages.map((stage, i) => {
      const name = textField({
        label: t("stageName"),
        hideLabel: true,
        value: stage.name,
        onInput: (v) => {
          stage.name = v.trim() || stage.name;
          changed();
        },
      });
      const live = toggle({
        label: t("stageLive"),
        checked: stage.live === true,
        onChange: (on) => {
          for (const s of config.stages) delete s.live;
          if (on) stage.live = true;
          changed();
          draw();
        },
      });
      const move = (by: number) => () => {
        const j = i + by;
        if (j < 0 || j >= config.stages.length) return;
        [config.stages[i], config.stages[j]] = [
          config.stages[j],
          config.stages[i],
        ];
        changed();
        draw();
      };
      const line = row(
        name.el,
        live.el,
        button({
          label: t("moveUp"),
          icon: "chevron-up",
          iconOnly: true,
          variant: "ghost",
          size: "sm",
          onClick: move(-1),
        }),
        button({
          label: t("moveDown"),
          icon: "chevron-down",
          iconOnly: true,
          variant: "ghost",
          size: "sm",
          onClick: move(1),
        }),
        button({
          label: t("removeStage", { name: stage.name }),
          icon: "trash",
          iconOnly: true,
          variant: "ghost",
          size: "sm",
          onClick: () => {
            if (config.stages.length <= 1) return;
            config.stages.splice(i, 1);
            changed();
            draw();
          },
        }),
      );
      line.style.alignItems = "center";
      name.el.style.flex = "1";
      return line;
    });
    const addStage = button({
      label: t("addStage"),
      icon: "plus",
      variant: "secondary",
      size: "sm",
      onClick: () => {
        let n = config.stages.length + 1;
        while (config.stages.some((s) => s.id === `stage-${n}`)) n++;
        config.stages.push({ id: `stage-${n}`, name: t("newStage") });
        changed();
        draw();
      },
    });
    const resetStages = button({
      label: t("resetStages"),
      variant: "ghost",
      size: "sm",
      onClick: () => {
        config.stages = defaultStages();
        changed();
        draw();
      },
    });

    // ─── Recognizing ─────────────────────────────────────────────────────
    const auto = toggle({
      label: t("autoAssign"),
      hint: t("autoAssignHint"),
      checked: config.auto,
      onChange: (on) => {
        config.auto = on;
        changed();
        draw();
      },
    });

    // ─── Environments ────────────────────────────────────────────────────
    const envRows = envs.map((e) => {
      const own = config.envs[e.environment] ?? {};
      const set = (patch: Partial<typeof own>) => {
        const next = { ...(config.envs[e.environment] ?? {}), ...patch };
        for (const k of Object.keys(next) as (keyof typeof next)[])
          if (next[k] === undefined || next[k] === "") delete next[k];
        if (Object.keys(next).length) config.envs[e.environment] = next;
        else delete config.envs[e.environment];
        changed();
      };
      const seen = recognize(e.environment, e.production);
      const placed = place(
        { environment: e.environment, production: e.production },
        { ...config, envs: {} },
      );
      const autoName =
        placed.stage === OTHER
          ? t("stageOther")
          : (config.stages.find((s) => s.id === placed.stage)?.name ?? "—");
      const stage = select({
        label: t("stage"),
        hideLabel: true,
        options: [
          { value: "", label: t("stageAuto", { name: autoName }) },
          ...stageOptions(true),
        ],
        value: own.stage ?? "",
        onChange: (v) => set({ stage: v || undefined }),
      });
      const service = textField({
        label: t("deployService"),
        hideLabel: true,
        value: own.service ?? "",
        placeholder: seen.service ?? seen.region ?? "—",
        onInput: (v) => set({ service: v.trim() || undefined }),
      });
      const shown = toggle({
        label: t("showEnvironment", { name: e.environment }),
        hideLabel: true,
        checked: !own.hidden,
        onChange: (on) => set({ hidden: on ? undefined : true }),
      });
      const old =
        e.at !== null && Date.now() - Date.parse(e.at) > OLD_DAYS * 86_400_000;
      return {
        env: row(
          text({ text: e.environment, mono: true, size: "sm" }),
          ...(!firstTime && !known.has(e.environment)
            ? [badge({ text: t("new"), tone: "info" })]
            : []),
        ),
        stage: stage.el,
        service: service.el,
        last: text({
          text: e.at ? ago(e.at) : "—",
          size: "xs",
          tone: old ? "warning" : "subtle",
        }),
        shown: shown.el,
      };
    });

    // ─── Workflows ───────────────────────────────────────────────────────
    const wfRows = workflows.map((w) => {
      const own = () => config.workflows.find((x) => x.workflow === w.file);
      const set = (patch: Partial<WorkflowSetting>) => {
        const i = config.workflows.findIndex((x) => x.workflow === w.file);
        const next: WorkflowSetting = {
          ...(own() ?? { workflow: w.file }),
          ...patch,
        };
        for (const k of Object.keys(next) as (keyof WorkflowSetting)[])
          if (next[k] === undefined || next[k] === "") delete next[k];
        const plain =
          Object.keys(next).length === 1 && next.workflow === w.file;
        if (plain) {
          if (i >= 0) config.workflows.splice(i, 1);
        } else if (i >= 0) config.workflows[i] = next;
        else config.workflows.push(next);
        changed();
      };
      const current = own();
      const startable = w.inputs !== null;
      const prefill = stack(
        ...(w.inputs ?? []).map((input) => {
          const line = row(
            text({ text: input.name, mono: true, size: "xs" }),
            textField({
              label: t("prefillFor", { name: input.name }),
              hideLabel: true,
              value: current?.prefill?.[input.name] ?? "",
              placeholder:
                typeof input.default === "string"
                  ? input.default
                  : t("prefillHint"),
              onInput: (v) => {
                const next = { ...(own()?.prefill ?? {}) };
                if (v.trim()) next[input.name] = v.trim();
                else delete next[input.name];
                set({ prefill: Object.keys(next).length ? next : undefined });
              },
            }).el,
          );
          // Name and field in columns, one under the other.
          line.style.display = "grid";
          line.style.gridTemplateColumns = "6.5rem minmax(9rem, 1fr)";
          line.style.alignItems = "center";
          return line;
        }),
      );
      prefill.style.gap = "0.375rem";
      return {
        workflow: stack(
          row(
            text({ text: w.file, mono: true, size: "sm" }),
            ...(!firstTime && !known.has(`wf:${w.file}`)
              ? [badge({ text: t("new"), tone: "info" })]
              : []),
          ),
          text({ text: w.name, size: "xs", tone: "subtle" }),
        ),
        show: toggle({
          label: t("showWorkflow", { name: w.file }),
          hideLabel: true,
          checked: current?.show !== false,
          onChange: (on) => set({ show: on ? undefined : false }),
        }).el,
        start: startable
          ? stack(
              toggle({
                label: t("startableWorkflow", { name: w.file }),
                hideLabel: true,
                checked: current?.start === true,
                onChange: (on) => {
                  set({ start: on || undefined });
                  // Who may, and what's filled in, only for one that is.
                  draw();
                },
              }).el,
              ...(current?.start
                ? [
                    select({
                      label: t("whoMayStart"),
                      hideLabel: true,
                      options: [
                        { value: "members", label: t("startByMembers") },
                        { value: "managers", label: t("startByManagers") },
                      ],
                      value: current?.startBy ?? "members",
                      onChange: (v) =>
                        set({
                          startBy: v === "managers" ? "managers" : undefined,
                        }),
                    }).el,
                  ]
                : []),
            )
          : text({ text: t("notStartable"), size: "xs", tone: "subtle" }),
        prefill:
          startable && current?.start && (w.inputs ?? []).length
            ? prefill
            : text({ text: "–", tone: "subtle" }),
        stage: stack(
          select({
            label: t("stage"),
            hideLabel: true,
            options: [
              { value: "", label: t("noDeployment") },
              ...stageOptions(false),
            ],
            value: current?.stage ?? "",
            onChange: (v) => set({ stage: v || undefined }),
          }).el,
          textField({
            label: t("onlyBranch"),
            hideLabel: true,
            value: current?.branch ?? "",
            placeholder: t("anyBranch"),
            onInput: (v) => set({ branch: v.trim() || undefined }),
          }).el,
        ),
      };
    });

    // ─── Patterns ────────────────────────────────────────────────────────
    const patternRows = config.patterns.map((p, i) => {
      const line = row(
        textField({
          label: t("patternMatch"),
          hideLabel: true,
          value: p.match,
          placeholder: "pr-*",
          onInput: (v) => {
            p.match = v.trim();
            changed();
          },
        }).el,
        text({ text: "→", tone: "subtle" }),
        select({
          label: t("stage"),
          hideLabel: true,
          options: stageOptions(true),
          value: p.stage,
          onChange: (v) => {
            p.stage = v;
            changed();
          },
        }).el,
        textField({
          label: t("deployService"),
          hideLabel: true,
          value: p.service ?? "",
          placeholder: t("patternServiceHint"),
          onInput: (v) => {
            p.service = v.trim() || undefined;
            changed();
          },
        }).el,
        button({
          label: t("removePattern"),
          icon: "trash",
          iconOnly: true,
          variant: "ghost",
          size: "sm",
          onClick: () => {
            config.patterns.splice(i, 1);
            changed();
            draw();
          },
        }),
      );
      line.style.alignItems = "center";
      return line;
    });

    const body = stack(
      heading({ text: t("deployments"), level: 3 }),
      text({ text: t("deploySettingsIntro"), tone: "subtle", size: "sm" }),
      sectionHeader({ size: "sm", title: t("stages"), icon: "flag" }),
      text({ text: t("stagesHint"), tone: "subtle", size: "xs" }),
      ...stageRows,
      row(addStage, resetStages),
      auto.el,
      sectionHeader({ size: "sm", title: t("environments"), icon: "globe" }),
      envs.length
        ? table({
            columns: [
              { key: "env", label: t("environment") },
              { key: "stage", label: t("stage") },
              { key: "service", label: t("serviceOrRegion") },
              { key: "last", label: t("lastDeployed") },
              { key: "shown", label: t("show") },
            ],
            rows: envRows,
          })
        : text({ text: t("noEnvironments"), tone: "subtle", size: "sm" }),
      sectionHeader({ size: "sm", title: t("workflowsTitle"), icon: "play" }),
      text({ text: t("workflowsSettingsHint"), tone: "subtle", size: "xs" }),
      workflows.length
        ? table({
            columns: [
              { key: "workflow", label: t("workflow") },
              { key: "show", label: t("showInIssue") },
              { key: "start", label: t("startable") },
              { key: "prefill", label: t("prefill") },
              { key: "stage", label: t("asDeployment") },
            ],
            rows: wfRows,
          })
        : text({ text: t("noWorkflows"), tone: "subtle", size: "sm" }),
      sectionHeader({ size: "sm", title: t("patterns"), icon: "filter" }),
      text({ text: t("patternsHint"), tone: "subtle", size: "xs" }),
      ...patternRows,
      button({
        label: t("addPattern"),
        icon: "plus",
        variant: "secondary",
        size: "sm",
        onClick: () => {
          config.patterns.push({
            match: "",
            stage: config.stages[0]?.id ?? OTHER,
          });
          changed();
          draw();
        },
      }),
    );
    body.style.gap = "0.75rem";
    el.replaceChildren(body);
  };
  draw();

  return async () => {
    const latest = (await api.settings.get().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const kept = writeConfig({
      ...config,
      patterns: config.patterns.filter((p) => p.match),
      known: [
        ...envs.map((e) => e.environment),
        ...workflows.map((w) => `wf:${w.file}`),
      ],
    });
    await api.settings.set({ ...latest, deployments: kept as never });
    for (const k of kept.known) known.add(k);
    host.unsaved(false);
  };
}
