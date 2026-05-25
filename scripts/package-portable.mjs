#!/usr/bin/env node
/**
 * Package a portable Persistent Sage folder (persistent-sage.exe + launcher) for USB distribution.
 * Run after: npm run tauri build
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "src-tauri", "target", "release", "persistent-sage.exe");
const out = join(root, "dist", "PersistentSagePortable");
const readmeSrc = join(root, "packaging", "windows", "README.txt");

if (!existsSync(exe)) {
  console.error("Missing persistent-sage.exe — run: npm run tauri build");
  process.exit(1);
}

mkdirSync(out, { recursive: true });
cpSync(exe, join(out, "persistent-sage.exe"));
cpSync(
  join(root, "packaging", "windows", "Start-Persistent-Sage-Portable.bat"),
  join(out, "Start-Persistent-Sage-Portable.bat"),
);
if (existsSync(readmeSrc)) {
  cpSync(readmeSrc, join(out, "README.txt"));
}

console.log(`Portable package: ${out}`);
