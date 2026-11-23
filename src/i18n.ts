import { translator } from "@barynt/plugin-sdk";

// The plugin's own texts, in the person's language — English, and German.
// What Barynt shows from the manifest (titles, labels, settings) is
// translated there, under `locales`.

const en = {
  // Actions (BARY-230)
  pickIssue: "Pick an issue first.",
  connectOrToken:
    "Connect GitHub in the project's settings → Plugins → GitHub, or keep your own token under your settings.",
  branchCreated: "Branch {name} created in {repo}.",
  copied: "Copied {name}",
  noBranchYet: "No branch for this issue yet — create one first.",
  done: "Done.",

  // Creating a branch
  pickRepository:
    "Pick a repository in the project's settings → Plugins → GitHub.",
  repoNotShown:
    "GitHub doesn't show {repo} — share it with the app, or keep a token that sees it.",
  tokenRefused: "GitHub doesn't accept the token any more.",
  answeredFor: "GitHub answered {status} for {repo}.",
  answered: "GitHub answered {status}.",
  noBase: "{repo} has no {base} to branch from.",
  noWriteRight: "No right to write to {repo} (Contents: read and write).",
  namesTaken: "{name} and the next names are taken in {repo}.",

  // Pull requests
  merged: "Merged",
  closed: "Closed",
  draft: "Draft",
  changesRequested: "Changes requested",
  approved: "Approved",
  open: "Open",

  // The "Development" panel (BARY-229)
  minutesAgo: "{count} min ago",
  hoursAgo: "{count} h ago",
  daysAgo: "{count} d ago",
  reviewsAnswered: "GitHub answered {status} for the reviews.",
  noReviews: "No reviews yet.",
  connectForReviews:
    "Connect GitHub in the project's settings, or keep your own token, to see who reviewed.",
  reviewsFailed: "Reviews couldn't be loaded.",
  loadingReviews: "Loading reviews…",
  openOnGitHub: "Open on GitHub",
  branch: "Branch",
  noBranchNames: "No branch names this issue yet.",
  createBranch: "Create branch",
  copyBranchName: "Copy branch name",
  pullRequests: "Pull requests",
  commits: "Commits",
  showAll: "Show all {count}",

  // The settings section (BARY-231)
  checking: "Checking…",
  checkAgain: "Check again",
  reposOnGitHub: "Repositories on GitHub",
  tickRepos:
    "Tick the repositories above and save — the plugin creates branches in the first one.",
  fromBranch: "from {branch}",
  branches: "Branches",
  private: "private",
  public: "public",
  you: "you",
  examplePreview: 'A branch for {key} "{title}" is named {name}.',
  exampleTitle: "Keep the session cookie",
  ready: "Ready",
  readOnly: "Read only — no branches",
  notFound: "Not found — not shared with the app",
  badToken: "GitHub doesn't accept the token",
  connectToCheck: "Connect GitHub above to check",
};

export const t = translator({
  en,
  de: {
    pickIssue: "Wähle zuerst ein Issue.",
    connectOrToken:
      "Verbinde GitHub in den Projekteinstellungen → Plugins → GitHub, oder hinterlege dein eigenes Token in deinen Einstellungen.",
    branchCreated: "Branch {name} in {repo} erstellt.",
    copied: "{name} kopiert",
    noBranchYet: "Dieses Issue hat noch keinen Branch – erstelle zuerst einen.",
    done: "Erledigt.",

    pickRepository:
      "Wähle ein Repository in den Projekteinstellungen → Plugins → GitHub.",
    repoNotShown:
      "GitHub zeigt {repo} nicht – gib es für die App frei oder hinterlege ein Token, das es sieht.",
    tokenRefused: "GitHub akzeptiert das Token nicht mehr.",
    answeredFor: "GitHub hat für {repo} mit {status} geantwortet.",
    answered: "GitHub hat mit {status} geantwortet.",
    noBase: "{repo} hat kein {base}, von dem abgezweigt werden kann.",
    noWriteRight:
      "Keine Schreibrechte für {repo} (Contents: Lesen und Schreiben).",
    namesTaken: "{name} und die nächsten Namen sind in {repo} schon vergeben.",

    merged: "Gemergt",
    closed: "Geschlossen",
    draft: "Entwurf",
    changesRequested: "Änderungen angefragt",
    approved: "Freigegeben",
    open: "Offen",

    minutesAgo: "vor {count} Min.",
    hoursAgo: "vor {count} Std.",
    daysAgo: "vor {count} T.",
    reviewsAnswered: "GitHub hat für die Reviews mit {status} geantwortet.",
    noReviews: "Noch keine Reviews.",
    connectForReviews:
      "Verbinde GitHub in den Projekteinstellungen oder hinterlege dein eigenes Token, um die Reviews zu sehen.",
    reviewsFailed: "Die Reviews konnten nicht geladen werden.",
    loadingReviews: "Reviews werden geladen…",
    openOnGitHub: "Auf GitHub öffnen",
    branch: "Branch",
    noBranchNames: "Noch kein Branch nennt dieses Issue.",
    createBranch: "Branch erstellen",
    copyBranchName: "Branch-Namen kopieren",
    pullRequests: "Pull Requests",
    commits: "Commits",
    showAll: "Alle {count} anzeigen",

    checking: "Wird geprüft…",
    checkAgain: "Erneut prüfen",
    reposOnGitHub: "Repositories auf GitHub",
    tickRepos:
      "Wähle oben die Repositories aus und speichere – das Plugin erstellt Branches im ersten.",
    fromBranch: "von {branch}",
    branches: "Branches",
    private: "privat",
    public: "öffentlich",
    you: "du",
    examplePreview: "Ein Branch für {key} „{title}“ heißt {name}.",
    exampleTitle: "Session-Cookie behalten",
    ready: "Bereit",
    readOnly: "Nur lesen – keine Branches",
    notFound: "Nicht gefunden – nicht für die App freigegeben",
    badToken: "GitHub akzeptiert das Token nicht",
    connectToCheck: "Verbinde GitHub oben, um zu prüfen",
  },
});
