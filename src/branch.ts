// Naming a branch for an issue (BARY-230): the project's pattern with the
// person's GitHub login, the issue's key and its title — and the
// repositories the project works in. Pure, no GitHub.

/** The pattern when the project sets none. */
export const DEFAULT_PATTERN = "{user}/{key}-{title}";

/** A title as a branch name's part: lower case, ascii, words by "-". */
export function slug(text: string, max = 40): string {
  const full = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (full.length <= max) return full;
  // Cut after the last whole word that fits — mid-word only for one longer.
  const cut = full.slice(0, max + 1).lastIndexOf("-");
  return (cut > 0 ? full.slice(0, cut) : full.slice(0, max)).replace(/-+$/, "");
}

/**
 * The branch's name: `{user}`, `{key}` (`web-42`) and `{title}` filled in,
 * then made a valid Git ref — no spaces, no `..`, no `~^:?*[\\`, no empty
 * parts, no `.lock` or `/` at the end.
 */
export function branchName(
  pattern: string,
  parts: { user: string; key: string; title: string },
): string {
  const filled = (pattern.trim() || DEFAULT_PATTERN)
    .replaceAll("{user}", parts.user.toLowerCase())
    .replaceAll("{key}", parts.key.toLowerCase())
    .replaceAll("{title}", slug(parts.title));
  return filled
    .replace(/[\s~^:?*[\]\\]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .split("/")
    .map((p) => p.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean)
    .join("/")
    .replace(/\.lock$/, "")
    .slice(0, 200);
}

/** The repositories from the setting: `owner/repo`, one per line (or by
 *  commas), anything else left out. */
export function parseRepositories(text: unknown): string[] {
  if (typeof text !== "string") return [];
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((r) =>
          r
            .trim()
            .replace(/^https:\/\/github\.com\//, "")
            .replace(/\.git$/, ""),
        )
        .filter((r) => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(r)),
    ),
  ];
}

/** GitHub's page to open a pull request for the branch, its title with the
 *  issue's key so Barynt links it. */
export function compareUrl(
  repo: string,
  branch: string,
  title: string,
): string {
  const path = branch.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repo}/compare/${path}?expand=1&title=${encodeURIComponent(title)}`;
}
