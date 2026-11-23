import { BaryntError, type Plugin } from "@barynt/plugin-sdk";

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
      permissions?: { push?: boolean };
    }>();
    return {
      repo,
      state: data.permissions?.push ? "ok" : "read-only",
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
      return { text: "Ready", tone: "success" };
    case "read-only":
      return { text: "Read only — no branches", tone: "warning" };
    case "missing":
      return { text: "Not found — not shared with the app", tone: "danger" };
    case "bad-token":
      return { text: "GitHub doesn't accept the token", tone: "danger" };
    case "no-token":
      return { text: "Connect GitHub above to check", tone: "neutral" };
    default:
      return {
        text: `GitHub answered ${check.status ?? "?"}`,
        tone: "warning",
      };
  }
}
