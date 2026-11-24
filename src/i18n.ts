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
    "Pick a repository under Settings → Plugins → GitHub, tab Project.",
  pickBranchRepo: "Create the branch in which repository?",
  createBranchTitle: "Create branch",
  createBranchIn: "In {repo}.",
  branchNameLabel: "Branch name",
  baseBranch: "From branch",
  baseBranchHint: "Empty: the repository's default branch.",
  badBranchName:
    "That isn't a branch name Git takes — no spaces, ~ ^ : ? * [ or \\.",
  branchNameTaken:
    "There's a branch {name} already, or GitHub doesn't take the name.",
  pickBranch: "Pick a branch in the issue's Development section.",
  renameBranch: "Rename branch",
  renameBranchTitle: "Rename branch",
  renameBranchIn: "In {repo}. Pull requests from it follow the new name.",
  branchRenamed: "Branch renamed to {name}.",
  deleteBranch: "Delete branch",
  deleteBranchTitle: "Delete branch?",
  deleteBranchText:
    "{name} is deleted in {repo}. An open pull request from it is closed.",
  branchDeleted: "Branch {name} deleted.",
  defaultRepo: "Where branches go by default",
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

  // GitHub Actions (BARY-238)
  pickWorkflow:
    "Name a workflow in the project's settings → Plugins → GitHub first.",
  workflowStarted: "{workflow} started on {branch}.",
  workflowNotFound: "GitHub doesn't know the workflow {workflow} in {repo}.",
  workflowNoDispatch:
    "{workflow} can't be started by hand — it needs `on: workflow_dispatch`.",
  workflowNoRight:
    "No right to start workflows — the GitHub App needs Actions: write.",
  runWorkflow: "Run workflow",

  // Deployments
  deployments: "Deployments",
  deployedOk: "Deployed",
  deployFailed: "Failed",
  deploying: "Deploying",
  production: "Production",
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
      "Wähle ein Repository unter Einstellungen → Plugins → GitHub, Tab Projekt.",
    pickBranchRepo: "In welchem Repository soll der Branch entstehen?",
    createBranchTitle: "Branch erstellen",
    createBranchIn: "In {repo}.",
    branchNameLabel: "Branch-Name",
    baseBranch: "Ausgehend von",
    baseBranchHint: "Leer: der Standard-Branch des Repositorys.",
    badBranchName:
      "Diesen Namen nimmt Git nicht – keine Leerzeichen, ~ ^ : ? * [ oder \\.",
    branchNameTaken:
      "Es gibt schon einen Branch {name}, oder GitHub nimmt den Namen nicht.",
    pickBranch: "Wähle einen Branch im Abschnitt Entwicklung des Issues.",
    renameBranch: "Branch umbenennen",
    renameBranchTitle: "Branch umbenennen",
    renameBranchIn: "In {repo}. Pull Requests davon folgen dem neuen Namen.",
    branchRenamed: "Branch umbenannt in {name}.",
    deleteBranch: "Branch löschen",
    deleteBranchTitle: "Branch löschen?",
    deleteBranchText:
      "{name} wird in {repo} gelöscht. Ein offener Pull Request davon wird geschlossen.",
    branchDeleted: "Branch {name} gelöscht.",
    defaultRepo: "Standard für neue Branches",
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
    changesRequested: "Änderungen gewünscht",
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

    pickWorkflow:
      "Trage zuerst einen Workflow in den Projekteinstellungen → Plugins → GitHub ein.",
    workflowStarted: "{workflow} auf {branch} gestartet.",
    workflowNotFound: "GitHub kennt den Workflow {workflow} in {repo} nicht.",
    workflowNoDispatch:
      "{workflow} lässt sich nicht von Hand starten – er braucht `on: workflow_dispatch`.",
    workflowNoRight:
      "Keine Rechte, Workflows zu starten – die GitHub App braucht Actions: write.",
    runWorkflow: "Workflow starten",

    deployments: "Deployments",
    deployedOk: "Deployt",
    deployFailed: "Fehlgeschlagen",
    deploying: "Läuft",
    production: "Produktion",
  },
});
