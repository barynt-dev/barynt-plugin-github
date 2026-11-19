import { Plugin } from "@barynt/plugin-sdk";

// The plugin's part in Barynt's frames. What it draws — the pull request's
// row on a card, the "Development" panel, the actions — comes in the next
// steps; until then it only has to load.
export default class GitHub extends Plugin {
  onload() {}
}
