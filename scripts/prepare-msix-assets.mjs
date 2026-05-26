import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const assetsDir = path.resolve("Assets");
const iconsDir = path.resolve("src-tauri", "icons");

await mkdir(assetsDir, { recursive: true });

const copies = [
  ["StoreLogo.png", "StoreLogo.png"],
  ["Square44x44Logo.png", "Square44x44Logo.png"],
  ["Square150x150Logo.png", "Square150x150Logo.png"],
  ["Square310x310Logo.png", "Square310x310Logo.png"],
  // The manifest expects a wide tile. Reuse the square logo until dedicated
  // Microsoft Store tile art is produced.
  ["Square150x150Logo.png", "Wide310x150Logo.png"],
];

for (const [from, to] of copies) {
  await copyFile(path.join(iconsDir, from), path.join(assetsDir, to));
}

console.log(`persistent-sage-msix: wrote assets to ${assetsDir}`);
