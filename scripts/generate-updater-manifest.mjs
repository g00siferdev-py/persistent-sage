import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repo = process.env.GITHUB_REPOSITORY || "g00siferdev-py/persistent-sage";
const tag = process.env.GITHUB_REF_NAME || `v${process.env.npm_package_version || "0.0.0"}`;
const version = tag.startsWith("v") ? tag.slice(1) : tag;
const nsisDir = path.resolve("src-tauri", "target", "release", "bundle", "nsis");
const outDir = path.resolve("dist");
const outPath = path.join(outDir, "latest.json");

const files = await readdir(nsisDir);
const installer = files
  .filter((name) => name.endsWith("-setup.exe"))
  .sort()
  .at(-1);

if (!installer) {
  throw new Error(`No NSIS setup executable found in ${nsisDir}`);
}

const sigPath = path.join(nsisDir, `${installer}.sig`);
const signature = (await readFile(sigPath, "utf8")).trim();
if (!signature) {
  throw new Error(`Updater signature file is empty: ${sigPath}`);
}

// GitHub release uploads normalize spaces in asset names to dots while keeping
// the display label human-friendly. The updater needs the actual asset name.
const githubAssetName = installer.replace(/\s+/g, ".");
const assetUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(githubAssetName)}`;

const manifest = {
  version,
  notes: `Persistent Sage ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: assetUrl,
    },
  },
};

await mkdir(outDir, { recursive: true });
await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`persistent-sage-updater: wrote ${outPath}`);
console.log(`persistent-sage-updater: ${githubAssetName}`);
