// The plugin's pictures for its release (BARY-235): logo.png from
// assets/logo.svg, and preview-*.webp from the screenshots in
// assets/screenshots/ — 16:10, WebP, within Barynt's limits (128 KB for
// the logo, 512 KB per preview). Needs `sharp` (bun add -d sharp).
import { readdirSync } from "node:fs";
import sharp from "sharp";

await sharp("assets/logo.svg")
  .resize(256, 256)
  .png({ compressionLevel: 9 })
  .toFile("logo.png");
const shots = readdirSync("assets/screenshots")
  .filter((f) => /^preview-[1-6]\.png$/.test(f))
  .sort();
for (const shot of shots)
  await sharp(`assets/screenshots/${shot}`)
    .resize(1440, 900, { fit: "cover", position: "top" })
    .webp({ quality: 82 })
    .toFile(shot.replace(".png", ".webp"));
console.log(`logo.png, ${shots.length} previews`);
