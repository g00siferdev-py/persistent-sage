/**
 * Generate NSIS installer BMPs (150×57 header, 164×314 sidebar).
 * Uses sharp (devDependency) — no Python required on Windows.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_HEADER = join(ROOT, "public", "nova-logo.png");
const SRC_SIDEBAR = join(ROOT, "packaging", "branding", "NovaLogo.png");
const OUT_DIR = join(ROOT, "packaging", "windows");
const OUT_HEADER = join(OUT_DIR, "nsis-header.bmp");
const OUT_SIDEBAR = join(OUT_DIR, "nsis-sidebar.bmp");

const BG = [15, 23, 42];

function writeBmp(path, width, height, rgbRows) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const rows = [];
  for (let y = height - 1; y >= 0; y--) {
    const row = rgbRows[y];
    const padded = Buffer.alloc(rowStride, 0);
    row.copy(padded, 0);
    rows.push(padded);
  }
  const pixelData = Buffer.concat(rows);
  const fileSize = 54 + pixelData.length;
  const header = Buffer.alloc(54);
  header.write("BM", 0);
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixelData.length, 34);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([header, pixelData]));
}

function solidRows(w, h, rgb) {
  const row = Buffer.alloc(w * 3);
  for (let i = 0; i < w; i++) {
    row[i * 3] = rgb[2];
    row[i * 3 + 1] = rgb[1];
    row[i * 3 + 2] = rgb[0];
  }
  return Array.from({ length: h }, () => Buffer.from(row));
}

function rawToBmpRows(raw, width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      row[x * 3] = raw[i + 2];
      row[x * 3 + 1] = raw[i + 1];
      row[x * 3 + 2] = raw[i];
    }
    rows.push(row);
  }
  return rows;
}

function outputsFresh() {
  if (!existsSync(OUT_HEADER) || !existsSync(OUT_SIDEBAR)) return false;
  const outMtime = Math.min(
    statSync(OUT_HEADER).mtimeMs,
    statSync(OUT_SIDEBAR).mtimeMs,
  );
  const sources = [SRC_HEADER, SRC_SIDEBAR].filter((p) => existsSync(p));
  if (sources.length === 0) return true;
  return sources.every((p) => statSync(p).mtimeMs <= outMtime);
}

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

async function rowsFromPng(sharp, src, w, h) {
  const { data, info } = await sharp(src)
    .resize(w, h, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h) {
    throw new Error(`resize failed for ${src}`);
  }
  return rawToBmpRows(data, w, h);
}

async function main() {
  if (outputsFresh()) {
    console.log("NSIS branding BMPs up to date — skip regenerate");
    return;
  }

  const sharp = await loadSharp();
  if (!sharp) {
    if (existsSync(OUT_HEADER) && existsSync(OUT_SIDEBAR)) {
      console.log(
        "sharp not installed; using committed packaging/windows/*.bmp",
      );
      return;
    }
    console.error(
      "Missing NSIS BMPs and sharp is not installed.\n" +
        "  npm install\n" +
        "  or: npm run branding:nsis after npm install (adds sharp via devDependencies)",
    );
    process.exit(1);
  }

  let headerRows;
  let sidebarRows;
  try {
    if (!existsSync(SRC_HEADER)) throw new Error(`missing ${SRC_HEADER}`);
    headerRows = await rowsFromPng(sharp, SRC_HEADER, 150, 57);
    const sidebarSrc = existsSync(SRC_SIDEBAR) ? SRC_SIDEBAR : SRC_HEADER;
    sidebarRows = await rowsFromPng(sharp, sidebarSrc, 164, 314);
  } catch (e) {
    console.warn(`nova-branding: ${e} — solid placeholder`);
    headerRows = solidRows(150, 57, BG);
    sidebarRows = solidRows(164, 314, BG);
  }

  writeBmp(OUT_HEADER, 150, 57, headerRows);
  writeBmp(OUT_SIDEBAR, 164, 314, sidebarRows);
  console.log(`Wrote ${OUT_HEADER} and nsis-sidebar.bmp`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
