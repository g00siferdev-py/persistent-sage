#!/usr/bin/env node
/**
 * Package a portable Nova folder (nova.exe + portable launcher) for USB distribution.
 * Run after: npm run tauri build
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "src-tauri", "target", "release", "nova.exe");
const out = join(root, "dist", "NovaPortable");
const readmeSrc = join(root, "packaging", "windows", "README.txt");

if (!existsSync(exe)) {
  console.error("Missing nova.exe — run: npm run tauri build");
  process.exit(1);
}

mkdirSync(out, { recursive: true });
cpSync(exe, join(out, "nova.exe"));
cpSync(
  join(root, "packaging", "windows", "Start-Nova-Portable.bat"),
  join(out, "Start-Nova-Portable.bat"),
);
if (existsSync(readmeSrc)) {
  cpSync(readmeSrc, join(out, "README.txt"));
}

console.log(`Portable package: ${out}`);
