import type { Deployment } from "./entries";
import { t } from "./i18n";

// Where a deployment stands on the way out (BARY-238): GitHub knows only
// environments, named freely. The project's stages put them in order —
// Barynt suggests Preview, Test, Staging and Production, the project may
// rename, reorder, add or remove them — and each environment lands in one:
// set by hand, by a pattern, or recognized by its name. A workflow's run
// can count as a deployment too (`beta.yml` → Beta), for projects without
// environments. All of it lives in the `deployments` setting.

export interface Stage {
  id: string;
  name: string;
  /** What counts as shipped: the rule "Deployed to production", the
   *  board, the filter. One stage. */
  live?: boolean;
}

/** An environment set by hand: its stage (or `other`), service, region. */
export interface EnvSetting {
  stage?: string;
  service?: string;
  region?: string;
  hidden?: boolean;
}

export interface Pattern {
  /** `pr-*`, `*-staging` — `*` any text. */
  match: string;
  stage: string;
  /** `-` takes the part the `*` matched as the service. */
  service?: string;
  region?: string;
}

/** A workflow whose run counts as a deployment. `environment` and
 *  `production` are what Barynt reads when the run comes in. */
export interface WorkflowSetting {
  workflow: string;
  stage: string;
  environment: string;
  branch?: string;
  production?: boolean;
}

export interface DeployConfig {
  /** Recognize stage, service and region by an environment's name. */
  auto: boolean;
  stages: Stage[];
  envs: Record<string, EnvSetting>;
  patterns: Pattern[];
  workflows: WorkflowSetting[];
  /** Environments and workflows seen when last saved — what's new since. */
  known: string[];
}

/** The id of the stage for what fits none. */
export const OTHER = "other";

export function defaultStages(): Stage[] {
  return [
    { id: "preview", name: t("stagePreview") },
    { id: "test", name: t("stageTest") },
    { id: "staging", name: t("stageStaging") },
    { id: "production", name: t("stageProduction"), live: true },
  ];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 100) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** The setting as kept, defaults filled in — whatever it holds. */
export function readConfig(raw: unknown): DeployConfig {
  const o = isObj(raw) ? raw : {};
  const stages = Array.isArray(o.stages)
    ? o.stages.flatMap((s): Stage[] => {
        if (!isObj(s)) return [];
        const id = str(s.id, 40);
        const name = str(s.name, 40);
        return id && name && id !== OTHER
          ? [{ id, name, ...(s.live === true && { live: true }) }]
          : [];
      })
    : [];
  const envs: Record<string, EnvSetting> = {};
  if (isObj(o.envs))
    for (const [name, v] of Object.entries(o.envs).slice(0, 200))
      if (isObj(v))
        envs[name] = {
          ...(str(v.stage, 40) && { stage: str(v.stage, 40) }),
          ...(str(v.service, 40) && { service: str(v.service, 40) }),
          ...(str(v.region, 40) && { region: str(v.region, 40) }),
          ...(v.hidden === true && { hidden: true }),
        };
  const patterns = Array.isArray(o.patterns)
    ? o.patterns.flatMap((p): Pattern[] => {
        if (!isObj(p)) return [];
        const match = str(p.match, 100);
        const stage = str(p.stage, 40);
        return match && stage
          ? [
              {
                match,
                stage,
                ...(str(p.service, 40) && { service: str(p.service, 40) }),
                ...(str(p.region, 40) && { region: str(p.region, 40) }),
              },
            ]
          : [];
      })
    : [];
  const workflows = Array.isArray(o.workflows)
    ? o.workflows.flatMap((w): WorkflowSetting[] => {
        if (!isObj(w)) return [];
        const workflow = str(w.workflow, 200);
        const stage = str(w.stage, 40);
        const environment = str(w.environment, 100);
        return workflow && stage && environment
          ? [
              {
                workflow,
                stage,
                environment,
                ...(str(w.branch, 200) && { branch: str(w.branch, 200) }),
                ...(w.production === true && { production: true }),
              },
            ]
          : [];
      })
    : [];
  return {
    auto: o.auto !== false,
    stages: stages.length ? stages : defaultStages(),
    envs,
    patterns,
    workflows,
    known: Array.isArray(o.known)
      ? o.known.filter((k): k is string => typeof k === "string").slice(0, 500)
      : [],
  };
}

/** The setting to keep: each workflow told the environment it counts as
 *  and whether its stage is the live one. */
export function writeConfig(config: DeployConfig): DeployConfig {
  const live = config.stages.find((s) => s.live)?.id;
  return {
    ...config,
    workflows: config.workflows.map((w) => ({
      ...w,
      environment: workflowEnvironment(w.workflow),
      production: w.stage === live,
    })),
  };
}

/** The environment a workflow's runs count as: its file without `.yml`. */
export const workflowEnvironment = (file: string) =>
  file.replace(/\.ya?ml$/i, "");

/** A pattern as a test — `*` any text, case aside — and what it matched. */
export function matchPattern(pattern: string, name: string): string | null {
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("(.*)")}$`,
    "i",
  );
  const m = re.exec(name);
  return m ? (m[1] ?? "") : null;
}

const STAGE_WORDS: [string, RegExp][] = [
  ["production", /^(prod|production|prd|live)$/],
  ["staging", /^(staging|stage|stg|qa|uat|acceptance|preprod)$/],
  ["test", /^(test|testing|integration|ci|e2e|sandbox)$/],
  ["preview", /^(preview|review|pr|dev|development|feature|branch)$/],
];
const REGION =
  /^(eu|us|ap|sa|ca|me|af|apac|emea|amer|asia|global)(\d+)?$|^(eu|us|ap|sa|ca|me|af)(central|north|south|east|west)\d*$/;

/** Stage, service and region by an environment's name: `api-staging`,
 *  `web/production`, `prod-eu`, `pr-42`. */
export function recognize(
  name: string,
  production: boolean,
): { stage: string | null; service?: string; region?: string } {
  const lower = name.toLowerCase().replace(/pre-prod/g, "preprod");
  const tokens = lower.split(/[-_/\s.:]+/).filter(Boolean);
  let stage: string | null = null;
  const rest: string[] = [];
  for (const token of tokens) {
    const hit = STAGE_WORDS.find(([, re]) => re.test(token))?.[0];
    if (hit && !stage) stage = hit;
    else if (!/^\d+$/.test(token) && !hit) rest.push(token);
  }
  if (!stage && /^pr\d+$/.test(tokens[0] ?? "")) stage = "preview";
  if (!stage && production) stage = "production";
  if (!stage) return { stage: null };
  // A preview's other words are its branch: no service.
  if (stage === "preview") return { stage };
  const region = rest.filter((r) => REGION.test(r));
  const service = rest.filter((r) => !REGION.test(r));
  return {
    stage,
    ...(service.length && { service: service.join("-") }),
    ...(region.length && { region: region.join("-") }),
  };
}

export interface Placed {
  /** A stage's id, or `OTHER`. */
  stage: string;
  service?: string;
  region?: string;
  hidden: boolean;
  /** How it got there — the settings say so. */
  by: "hand" | "pattern" | "workflow" | "auto" | "none";
}

/** Where an environment (or a workflow's run) goes. */
export function place(
  d: { environment: string; production: boolean; workflowFile?: string },
  config: DeployConfig,
): Placed {
  const ids = new Set(config.stages.map((s) => s.id));
  const known = (id: string | undefined) =>
    id && (ids.has(id) || id === OTHER) ? id : null;
  if (d.workflowFile) {
    const w = config.workflows.find((x) => x.workflow === d.workflowFile);
    const stage = known(w?.stage);
    return stage
      ? { stage, hidden: false, by: "workflow" }
      : { stage: OTHER, hidden: true, by: "none" };
  }
  const own = config.envs[d.environment];
  if (own?.hidden)
    return { stage: known(own.stage) ?? OTHER, hidden: true, by: "hand" };
  if (own && known(own.stage))
    return {
      stage: known(own.stage) as string,
      ...(own.service && { service: own.service }),
      ...(own.region && { region: own.region }),
      hidden: false,
      by: "hand",
    };
  for (const p of config.patterns) {
    const matched = matchPattern(p.match, d.environment);
    const stage = known(p.stage);
    if (matched === null || !stage) continue;
    const service = p.service === "-" ? matched || undefined : p.service;
    return {
      stage,
      ...(service && { service }),
      ...(p.region && { region: p.region }),
      hidden: false,
      by: "pattern",
    };
  }
  if (config.auto) {
    const seen = recognize(d.environment, d.production);
    const stage = known(seen.stage ?? undefined);
    if (stage)
      return {
        stage,
        ...(seen.service && { service: own?.service ?? seen.service }),
        ...(seen.region && { region: own?.region ?? seen.region }),
        hidden: false,
        by: "auto",
      };
  }
  return { stage: OTHER, hidden: false, by: "none" };
}

/** A stage's state from its deployments: a failure first, then one that
 *  waits, one under way, else done — or nothing running there. */
export type StationState =
  | "failure"
  | "waiting"
  | "running"
  | "success"
  | "idle";

export function worst(states: Deployment["state"][]): StationState {
  if (states.includes("failure")) return "failure";
  if (states.includes("waiting")) return "waiting";
  if (states.includes("running") || states.includes("pending"))
    return "running";
  if (states.includes("success")) return "success";
  return "idle";
}

export interface Station {
  stage: Stage | { id: typeof OTHER; name: string };
  /** What's deployed there, newest first. */
  deployments: (Deployment & { placed: Placed })[];
  /** Known in the repository, not reached by this issue yet. */
  reached: boolean;
}

/** The issue's deployments by stage, in the project's order — a stage
 *  only when something's there, or it's one the repository deploys to
 *  (`expected`, from its recent deployments). */
export function stations(
  deployments: Deployment[],
  config: DeployConfig,
  expected: { environment: string; production: boolean }[] = [],
): Station[] {
  const placed = deployments
    .map((d) => ({ ...d, placed: place(d, config) }))
    .filter((d) => !d.placed.hidden)
    .sort((a, b) => b.at.localeCompare(a.at));
  const wanted = new Set(
    expected
      .map((e) => place(e, config))
      .filter((p) => !p.hidden && p.by !== "none")
      .map((p) => p.stage),
  );
  const all = [...config.stages, { id: OTHER, name: t("stageOther") } as const];
  // Not reached yet: only stages after the first it reached — what's
  // still ahead, not a preview it skipped.
  const first = all.findIndex((stage) =>
    placed.some((d) => d.placed.stage === stage.id),
  );
  return all.flatMap((stage, i): Station[] => {
    const here = placed.filter((d) => d.placed.stage === stage.id);
    if (here.length) return [{ stage, deployments: here, reached: true }];
    return wanted.has(stage.id) && stage.id !== OTHER && first >= 0 && i > first
      ? [{ stage, deployments: [], reached: false }]
      : [];
  });
}

/** The parts of a station: each service's and region's newest — a
 *  preview's environments each. */
export function partsOf(station: Station) {
  const seen = new Map<string, Deployment & { placed: Placed }>();
  for (const d of station.deployments) {
    const key =
      d.placed.service || d.placed.region
        ? `${d.placed.service ?? ""}|${d.placed.region ?? ""}`
        : `env|${d.environment}`;
    if (!seen.has(key)) seen.set(key, d);
  }
  return [...seen.values()];
}

/** The services the issue's deployments name — two or more: a matrix. */
export function servicesOf(list: Station[]): string[] {
  const set = new Set<string>();
  for (const s of list)
    for (const d of s.deployments)
      if (d.placed.service) set.add(d.placed.service);
  return [...set].sort();
}
