import { BaryntError, type Plugin } from "@barynt/plugin-sdk";
import { t } from "./i18n";

// The project's repositories as GitHub sees them (BARY-231) — with the
// person's token, or the project's GitHub connection (BARY-238): there,
// writable for branches, private or not.

type Api = Plugin["api"];

export type RepositoryCheck =
  | {
      repo: string;
      state: "ok" | "read-only";
      defaultBranch: string;
      private: boolean;
      url: string;
    }
  | {
      repo: string;
      state: "missing" | "no-token" | "bad-token" | "error";
      status?: number;
    };

/** One repository, asked of GitHub. */
export async function checkRepository(
  api: Api,
  repo: string,
): Promise<RepositoryCheck> {
  try {
    const res = await api.net.fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) return { repo, state: "missing" };
    if (res.status === 401) return { repo, state: "bad-token" };
    if (!res.ok) return { repo, state: "error", status: res.status };
    const data = res.json<{
      default_branch?: string;
      private?: boolean;
      html_url?: string;
      permissions?: { push?: boolean; pull?: boolean };
    }>();
    return {
      repo,
      // A person's token says what they may. An installation's (the
      // project's GitHub connection) answers every permission false — even
      // `pull`, which anyone who sees a repository has: its rights are the
      // app's (Contents: write), so it may.
      state:
        !data.permissions ||
        data.permissions.push ||
        data.permissions.pull === false
          ? "ok"
          : "read-only",
      defaultBranch: data.default_branch ?? "main",
      private: data.private === true,
      url: data.html_url ?? `https://github.com/${repo}`,
    };
  } catch (error) {
    if (error instanceof BaryntError && error.code === "credential_missing")
      return { repo, state: "no-token" };
    throw error;
  }
}

/** What a check says, in a few words, and how it reads. */
export function describeCheck(check: RepositoryCheck): {
  text: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  switch (check.state) {
    case "ok":
      return { text: t("ready"), tone: "success" };
    case "read-only":
      return { text: t("readOnly"), tone: "warning" };
    case "missing":
      return { text: t("notFound"), tone: "danger" };
    case "bad-token":
      return { text: t("badToken"), tone: "danger" };
    case "no-token":
      return { text: t("connectToCheck"), tone: "neutral" };
    default:
      return {
        text: t("answered", { status: check.status ?? "?" }),
        tone: "warning",
      };
  }
}
