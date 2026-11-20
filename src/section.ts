import type { Plugin } from "@barynt/plugin-sdk";
import {
  badge,
  button,
  link,
  notice,
  row,
  sectionHeader,
  stack,
  text,
} from "@barynt/plugin-sdk/ui";
import { branchName } from "./branch";
import { branchSettings } from "./github";
import { checkRepository, describeCheck } from "./repositories";

// Below Barynt's form of the plugin's settings (BARY-231): the saved
// repositories checked against GitHub with the person's token, and what a
// branch's name will look like. Changes show after saving.

type Api = Plugin["api"];

export async function renderSection(api: Api, el: HTMLElement): Promise<void> {
  const list = stack(text({ text: "Checking…", tone: "subtle", size: "sm" }));
  const preview = stack();
  const again = button({
    label: "Check again",
    icon: "refresh-cw",
    size: "sm",
    variant: "secondary",
    onClick: () => fill(),
  });
  const panel = stack(
    sectionHeader({ title: "Repositories on GitHub", icon: "git-branch" }),
    list,
    preview,
    row(again),
  );
  panel.style.padding = "0.25rem 0";
  el.replaceChildren(panel);

  async function fill(): Promise<void> {
    const settings = await branchSettings(api);
    if (settings.repositories.length === 0) {
      list.replaceChildren(
        notice({
          text: "Add owner/repo above and save — the plugin creates branches in the first one.",
          tone: "info",
        }),
      );
      preview.replaceChildren();
      return;
    }
    const checks = await Promise.all(
      settings.repositories.map((r) => checkRepository(api, r)),
    );
    list.replaceChildren(
      ...checks.map((check, i) => {
        const look = describeCheck(check);
        return row(
          check.state === "ok" || check.state === "read-only"
            ? link({ text: check.repo, href: check.url })
            : text({ text: check.repo, mono: true, inline: true }),
          badge({ text: look.text, tone: look.tone }),
          ...(check.state === "ok" || check.state === "read-only"
            ? [
                text({
                  text: [
                    `from ${check.defaultBranch}`,
                    check.private ? "private" : "public",
                    i === 0 ? "branches go here" : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  tone: "subtle",
                  size: "xs",
                  inline: true,
                }),
              ]
            : []),
        );
      }),
    );
    // The name a branch gets, with the person's login when GitHub knows it.
    let user = "you";
    try {
      const me = await api.net.fetch("https://api.github.com/user", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (me.ok) user = me.json<{ login?: string }>().login ?? user;
    } catch {}
    preview.replaceChildren(
      text({
        text: `A branch for WEB-42 "Keep the session cookie" is named ${branchName(
          settings.pattern,
          { user, key: "WEB-42", title: "Keep the session cookie" },
        )}.`,
        tone: "subtle",
        size: "sm",
      }),
    );
  }
  await fill();
}
