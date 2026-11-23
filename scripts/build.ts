import { readdirSync, watch } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";

const PICTURE = /^(logo|preview-[1-6])\.(png|webp)$/;
/** The store page's text, per language (`about.md`, `about.de.md`). */
const ABOUT = /^about(\.[a-z]{2})?\.md$/;

// The plugin, built into dist/: `main.js` (one ES module, the SDK bundled
// in), `manifest.json` and `styles.css` next to it. That's what Barynt
// loads from the folder in development (`PLUGIN_DEV_DIRS`) and what a
// release ships. `--watch` builds again on every change.

const watching = process.argv.includes("--watch");

async function build(): Promise<boolean> {
  await mkdir("dist", { recursive: true });
  const out = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: "dist",
    naming: "main.js",
    format: "esm",
    target: "browser",
    minify: !watching,
  });
  if (!out.success) {
    for (const log of out.logs) console.error(log);
    return false;
  }
  await copyFile("manifest.json", "dist/manifest.json");
  await copyFile("styles.css", "dist/styles.css");
  // Its pictures, when it has them: the logo and the store's previews; and
  // the text of its page in the store.
  for (const name of readdirSync(".").filter(
    (f) => PICTURE.test(f) || ABOUT.test(f),
  ))
    await copyFile(name, `dist/${name}`);
  console.log(`Built dist/ at ${new Date().toLocaleTimeString()}`);
  return true;
}

const ok = await build();
if (!watching) process.exit(ok ? 0 : 1);

let timer: ReturnType<typeof setTimeout> | undefined;
const again = () => {
  clearTimeout(timer);
  timer = setTimeout(build, 100);
};
watch("src", { recursive: true }, again);
watch("manifest.json", again);
watch("styles.css", again);
watch(".", (_, name) => {
  if (name && ABOUT.test(name)) again();
});
console.log("Watching src/, manifest.json, styles.css and about*.md …");
