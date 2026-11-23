import { afterEach, describe, expect, it } from "bun:test";
import { t } from "../src/i18n";
import { describeCheck } from "../src/repositories";
import { prLook } from "../src/row";

// The plugin's own texts follow the frame's language (`<html lang>`, set by
// the SDK from `context.locale`); English where there's none.

const g = globalThis as { document?: unknown };
const inLanguage = (lang: string) => {
  g.document = { documentElement: { lang } };
};
afterEach(() => {
  delete g.document;
});

const pr = {
  kind: "pull_request",
  repo: "acme/web",
  number: 7,
  state: "merged",
} as Parameters<typeof prLook>[0];

describe("texts", () => {
  it("are English without a language", () => {
    expect(prLook(pr).text).toBe("Merged");
    expect(t("showAll", { count: 4 })).toBe("Show all 4");
  });

  it("are German in a German frame", () => {
    inLanguage("de");
    expect(prLook(pr).text).toBe("Gemergt");
    expect(describeCheck({ repo: "acme/web", state: "missing" }).text).toBe(
      "Nicht gefunden – nicht für die App freigegeben",
    );
    expect(t("branchCreated", { name: "x", repo: "acme/web" })).toBe(
      "Branch x in acme/web erstellt.",
    );
  });

  it("fall back to English in another language", () => {
    inLanguage("fr");
    expect(prLook(pr).text).toBe("Merged");
  });
});
