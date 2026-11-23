import { describe, expect, it } from "bun:test";
import { branchName, compareUrl, parseRepositories, slug } from "../src/branch";

describe("a branch's name (BARY-230)", () => {
  it("fills in login, key and title", () => {
    expect(
      branchName("{user}/{key}-{title}", {
        user: "Ada",
        key: "NIM-42",
        title: "OAuth callback drops session on Safari 17!",
      }),
    ).toBe("ada/nim-42-oauth-callback-drops-session-on-safari");
  });

  it("stays a valid Git ref, with or without a login", () => {
    expect(
      branchName("{user}/{key}-{title}", {
        user: "",
        key: "WEB-1",
        title: "Fix: ünïcode ~ and .. dots",
      }),
    ).toBe("web-1-fix-unicode-and-dots");
    expect(
      branchName("feature/{key}..x.lock", {
        user: "a",
        key: "WEB-1",
        title: "",
      }),
    ).toBe("feature/web-1.x");
    expect(branchName("", { user: "a", key: "WEB-1", title: "T" })).toBe(
      "a/web-1-t",
    );
  });

  it("cuts a long title at a word", () => {
    expect(slug("a".repeat(30) + " bbbbbbbbbbbbbbbbbbbb")).toBe("a".repeat(30));
  });
});

describe("the repositories setting", () => {
  it("takes owner/repo, one per line or by commas, also as an address", () => {
    expect(
      parseRepositories(
        "acme/web\nhttps://github.com/acme/api.git, nonsense, acme/web\n  acme/docs.site ",
      ),
    ).toEqual(["acme/web", "acme/api", "acme/docs.site"]);
    expect(parseRepositories(undefined)).toEqual([]);
  });

  it("takes the list Barynt's picker keeps (BARY-238)", () => {
    expect(parseRepositories(["acme/web", "acme/api", 3, "acme/web"])).toEqual([
      "acme/web",
      "acme/api",
    ]);
  });
});

describe("opening a pull request", () => {
  it("goes to GitHub's compare page, its title with the key", () => {
    expect(
      compareUrl("acme/web", "ada/web-42", "WEB-42: Keep the cookie"),
    ).toBe(
      "https://github.com/acme/web/compare/ada/web-42?expand=1&title=WEB-42%3A%20Keep%20the%20cookie",
    );
  });
});
