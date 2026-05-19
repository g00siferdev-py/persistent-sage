/**
 * Import Nova `personality.json` exports and OpenClaw-style markdown identity files.
 *
 * OpenClaw workspace identity layer (typical files):
 * - SOUL.md — core truths, boundaries, vibe, continuity
 * - IDENTITY.md — name, creature, vibe, emoji, avatar (bullet list in official template)
 * - USER.md — human context and how to work with them
 * - JOURNAL.md / MEMORY.md — running notes (mapped to special instructions)
 * - TOOLS.md — tool notes
 * - HEARTBEAT.md / AGENTS.md — optional extras
 */

import type { PersonalityFile, PersonalityProfile } from "@/lib/personalityPrompt";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") return v;
  }
  return "";
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}`;
}

function normalizeProfile(raw: Record<string, unknown>, fallbackId: string): PersonalityProfile {
  return {
    id: pickStr(raw, "id", "profileId") || fallbackId,
    profileName: pickStr(raw, "profileName", "profile_name", "name") || "Imported profile",
    companionName: pickStr(raw, "companionName", "companion_name") || "Nova",
    corePersonality: pickStr(raw, "corePersonality", "core_personality"),
    toneOfVoice: pickStr(raw, "toneOfVoice", "tone_of_voice"),
    backgroundStory: pickStr(raw, "backgroundStory", "background_story"),
    coreValues: pickStr(raw, "coreValues", "core_values"),
    relationshipStyle: pickStr(raw, "relationshipStyle", "relationship_style"),
    specialInstructions: pickStr(raw, "specialInstructions", "special_instructions"),
    avatarDescription: (() => {
      const v = raw.avatarDescription ?? raw.avatar_description;
      if (v === null || v === undefined) return null;
      if (typeof v === "string") return v.trim() === "" ? null : v;
      return null;
    })(),
  };
}

function profileLooksNonEmpty(p: PersonalityProfile): boolean {
  return (
    p.profileName.trim() !== "" ||
    p.companionName.trim() !== "" ||
    p.corePersonality.trim() !== "" ||
    p.toneOfVoice.trim() !== "" ||
    p.backgroundStory.trim() !== "" ||
    p.coreValues.trim() !== "" ||
    p.relationshipStyle.trim() !== "" ||
    p.specialInstructions.trim() !== ""
  );
}

export type PersonalityJsonImport =
  | { kind: "file"; file: PersonalityFile }
  | { kind: "profiles"; profiles: PersonalityProfile[]; suggestedActiveId?: string };

/**
 * Parse JSON: full `PersonalityFile`, or `{ "profiles": [...] }`, or a single profile object.
 */
export function parsePersonalityJson(text: string): PersonalityJsonImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid JSON — could not parse the file.");
  }
  const root = asRecord(parsed);
  if (!root) throw new Error("JSON root must be an object.");

  const profilesRaw = root.profiles;
  if (Array.isArray(profilesRaw)) {
    const profiles = profilesRaw
      .map((p, i) => {
        const r = asRecord(p);
        if (!r) throw new Error(`profiles[${i}] must be an object.`);
        const id = pickStr(r, "id", "profileId") || newId();
        return normalizeProfile(r, id);
      })
      .filter(profileLooksNonEmpty);

    if (profiles.length === 0) throw new Error("No valid profiles found in JSON.");

    const hasFileShape =
      pickStr(root, "activeProfileId", "active_profile_id").length > 0 || typeof root.version === "number";

    if (hasFileShape) {
      const file: PersonalityFile = {
        version: typeof root.version === "number" ? root.version : 1,
        profiles,
        activeProfileId:
          pickStr(root, "activeProfileId", "active_profile_id") || profiles[0]?.id || "default",
      };
      if (!profiles.some((p) => p.id === file.activeProfileId)) {
        file.activeProfileId = profiles[0]!.id;
      }
      return { kind: "file", file };
    }

    return { kind: "profiles", profiles, suggestedActiveId: profiles[0]?.id };
  }

  if (
    "companionName" in root ||
    "companion_name" in root ||
    "corePersonality" in root ||
    "core_personality" in root ||
    "profileName" in root ||
    "profile_name" in root
  ) {
    const id = pickStr(root, "id", "profileId") || newId();
    const p = normalizeProfile(root, id);
    if (!profileLooksNonEmpty(p)) throw new Error("Single-profile JSON has no recognizable fields.");
    return { kind: "profiles", profiles: [p], suggestedActiveId: p.id };
  }

  throw new Error(
    "Unrecognized JSON shape. Expected Nova personality.json (with profiles[]) or a single profile object.",
  );
}

export type OpenclawFileKind =
  | "soul"
  | "identity"
  | "user"
  | "journal"
  | "memory"
  | "tools"
  | "heartbeat"
  | "agents";

export type OpenclawBundle = Partial<Record<OpenclawFileKind, string>>;

const OPENCLAW_STEMS: Record<string, OpenclawFileKind> = {
  soul: "soul",
  identity: "identity",
  user: "user",
  journal: "journal",
  memory: "memory",
  tools: "tools",
  heartbeat: "heartbeat",
  agents: "agents",
};

export type OpenclawImportPreview = {
  profile: PersonalityProfile;
  filesFound: OpenclawFileKind[];
  unrecognizedFileNames: string[];
  warnings: string[];
  /** Recommended OpenClaw files not included in this import. */
  missingRecommended: string[];
  /** When set, mapping could not run — show this instead of offering import. */
  fatalError?: string;
};

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinBlocks(blocks: string[], separator = "\n\n"): string {
  return blocks.map((b) => b.trim()).filter(Boolean).join(separator);
}

function isPlaceholderValue(v: string): boolean {
  const t = v.trim();
  if (!t) return true;
  if (t.startsWith("(") && t.endsWith(")")) return true;
  if (/^pick something/i.test(t)) return true;
  return false;
}

/** OpenClaw IDENTITY template: `- Name:` with value on same or next line. */
export function extractBulletValue(md: string, label: string): string {
  const sameLine = new RegExp(`^\\s*[-*]\\s*${escapeReg(label)}\\s*:\\s*(.+)$`, "im");
  const m = md.match(sameLine);
  if (m?.[1]) {
    const v = m[1].trim();
    if (!isPlaceholderValue(v)) return v;
  }

  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const bullet = line.match(new RegExp(`^[-*]\\s*${escapeReg(label)}\\s*:?\\s*(.*)$`, "i"));
    if (!bullet) continue;
    const inline = bullet[1]?.trim() ?? "";
    if (inline && !isPlaceholderValue(inline)) return inline;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!.trim();
      if (!next) continue;
      if (next.startsWith("#") || /^[-*]\s+/.test(next)) break;
      if (!isPlaceholderValue(next)) return next.replace(/^[-*]\s*/, "").trim();
      break;
    }
  }
  return "";
}

/** Extract first sensible agent name from OpenClaw IDENTITY.md (bullets or ## sections). */
export function extractIdentityName(markdown: string): string {
  const fromBullet = extractBulletValue(markdown, "Name");
  if (fromBullet) return fromBullet;

  const m = markdown.match(/^##\s*Name\s*$/im);
  if (m?.index !== undefined) {
    const rest = markdown.slice(m.index + m[0].length);
    const line = rest
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("#"));
    if (line) return line.replace(/^[-*]\s*/, "").trim();
  }
  const lineMatch = markdown.match(/^\s*[-*]?\s*Name:\s*(.+)$/im);
  if (lineMatch?.[1]) return lineMatch[1].trim();
  const h1 = markdown.match(/^#\s+(.+)$/m);
  if (h1?.[1] && !/^identity\.?md/i.test(h1[1].trim())) return h1[1].trim();
  return "";
}

function extractSection(md: string, heading: string): string {
  const re = new RegExp(`^##\\s*${escapeReg(heading)}\\s*$`, "im");
  const m = md.match(re);
  if (m?.index === undefined) return "";
  const start = m.index + m[0].length;
  const tail = md.slice(start);
  const next = tail.search(/\n##\s+/);
  const block = next === -1 ? tail : tail.slice(0, next);
  return block.trim();
}

/** Remove `## Heading` blocks from markdown (multiline). */
function stripMarkdownHeadings(md: string, headings: string[]): string {
  let out = md;
  for (const h of headings) {
    const re = new RegExp(`^##\\s*${escapeReg(h)}\\s*\\n[\\s\\S]*?(?=\\n##\\s|$)`, "im");
    out = out.replace(re, "\n");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function openclawStem(fileName: string): OpenclawFileKind | null {
  const base = fileName.replace(/^.*[/\\]/, "").trim().toLowerCase();
  const stem = base.replace(/\.(md|markdown|txt)$/i, "");
  if (OPENCLAW_STEMS[stem]) return OPENCLAW_STEMS[stem];
  if (base.endsWith(".md") || base.endsWith(".markdown")) {
    const mdStem = base.replace(/\.(md|markdown)$/i, "");
    return OPENCLAW_STEMS[mdStem] ?? null;
  }
  return null;
}

export function buildOpenclawBundle(files: { fileName: string; text: string }[]): {
  bundle: OpenclawBundle;
  unrecognizedFileNames: string[];
} {
  const bundle: OpenclawBundle = {};
  const unrecognizedFileNames: string[] = [];
  for (const { fileName, text } of files) {
    const stem = openclawStem(fileName);
    if (!stem) {
      unrecognizedFileNames.push(fileName);
      continue;
    }
    bundle[stem] = text;
  }
  return { bundle, unrecognizedFileNames };
}

function extractIdentityFields(identity: string) {
  return {
    name: extractBulletValue(identity, "Name") || extractIdentityName(identity),
    creature: extractBulletValue(identity, "Creature"),
    vibe: extractBulletValue(identity, "Vibe") || extractSection(identity, "Vibe"),
    emoji: extractBulletValue(identity, "Emoji"),
    avatar:
      extractBulletValue(identity, "Avatar") ||
      extractSection(identity, "Visual Description"),
  };
}

function mapSoul(soul: string) {
  const coreTruths = extractSection(soul, "Core Truths");
  const boundaries = extractSection(soul, "Boundaries");
  const vibe = extractSection(soul, "Vibe");
  const continuity = extractSection(soul, "Continuity");
  const communication = extractSection(soul, "Communication Style");
  const values = extractSection(soul, "Values");
  const principles = extractSection(soul, "Principles");

  let corePersonality = joinBlocks([
    coreTruths ? `## Core truths\n${coreTruths}` : "",
    boundaries ? `## Boundaries\n${boundaries}` : "",
    communication ? `## Communication style\n${communication}` : "",
  ]);

  let toneOfVoice = joinBlocks([vibe ? `## Vibe\n${vibe}` : "", extractSection(soul, "Tone")]);

  let coreValues = joinBlocks([
    values ? `## Values\n${values}` : "",
    principles ? `## Principles\n${principles}` : "",
  ]);

  const soulContinuity = continuity
    ? `## Continuity (from OpenClaw SOUL.md)\n${continuity}`
    : "";

  if (!corePersonality.trim()) {
    corePersonality = stripMarkdownHeadings(soul, [
      "Core Truths",
      "Boundaries",
      "Vibe",
      "Continuity",
      "Communication Style",
      "Values",
      "Principles",
      "Tone",
    ]);
    corePersonality = corePersonality.replace(/^#\s+.+$/m, "").trim();
  }

  if (!toneOfVoice.trim() && vibe) {
    toneOfVoice = `## Vibe\n${vibe}`;
  }

  return { corePersonality, toneOfVoice, coreValues, soulContinuity };
}

function parseUserMarkdown(user: string) {
  const relationshipBullets = [
    "Name",
    "What to call them",
    "Pronouns",
    "Timezone",
    "Notes",
  ];
  const relationshipParts: string[] = [];
  for (const label of relationshipBullets) {
    const v = extractBulletValue(user, label);
    if (v) relationshipParts.push(`- **${label}:** ${v}`);
  }

  const context = extractSection(user, "Context");
  const beforeContext = user.split(/^##\s*Context\s*$/im)[0] ?? user;
  const preamble = beforeContext
    .replace(/^#.+$/m, "")
    .replace(/^[-*]\s*.+$/gm, "")
    .trim();

  const relationship = joinBlocks(relationshipParts);
  const contextBlock = context.trim() || (relationship ? "" : preamble);

  return {
    relationship,
    context: contextBlock,
    full: user.trim(),
  };
}

function buildBackgroundStory(creature: string, emoji: string): string {
  const parts: string[] = [];
  if (creature) parts.push(`**Creature / role:** ${creature}`);
  if (emoji) parts.push(`**Signature emoji:** ${emoji}`);
  return joinBlocks(parts);
}

function bundleFileKinds(bundle: OpenclawBundle): OpenclawFileKind[] {
  return (Object.keys(bundle) as OpenclawFileKind[]).filter((k) => Boolean(bundle[k]?.trim()));
}

/**
 * Map an OpenClaw file bundle to a Nova profile (preview before save).
 */
function emptyOpenclawPreview(fatalError: string, unrecognizedFileNames: string[] = []): OpenclawImportPreview {
  return {
    profile: {
      id: newId(),
      profileName: "OpenClaw import",
      companionName: "Companion",
      corePersonality: "",
      toneOfVoice: "",
      backgroundStory: "",
      coreValues: "",
      relationshipStyle: "",
      specialInstructions: "",
      avatarDescription: null,
    },
    filesFound: [],
    unrecognizedFileNames,
    warnings: [],
    missingRecommended: ["SOUL.md", "IDENTITY.md", "USER.md"],
    fatalError,
  };
}

export function openclawBundleToProfile(bundle: OpenclawBundle): OpenclawImportPreview {
  const filesFound = bundleFileKinds(bundle);
  if (filesFound.length === 0) {
    return emptyOpenclawPreview(
      "No recognized OpenClaw files. Name them SOUL.md, IDENTITY.md, USER.md, etc. (stem must match; .md extension optional, case-insensitive).",
    );
  }

  const warnings: string[] = [];
  const missingRecommended: string[] = [];
  if (!bundle.soul?.trim()) missingRecommended.push("SOUL.md");
  if (!bundle.identity?.trim()) missingRecommended.push("IDENTITY.md");
  if (!bundle.user?.trim()) missingRecommended.push("USER.md (optional but recommended)");

  if (!bundle.soul?.trim() && !bundle.identity?.trim()) {
    warnings.push("Neither SOUL.md nor IDENTITY.md was provided — personality may be incomplete.");
  }

  const identity = bundle.identity ? extractIdentityFields(bundle.identity) : null;
  const soul = bundle.soul ? mapSoul(bundle.soul) : null;
  const user = bundle.user ? parseUserMarkdown(bundle.user) : null;

  const companionName = identity?.name?.trim() || "Companion";
  if (!identity?.name?.trim()) {
    warnings.push("No agent name found in IDENTITY.md — using “Companion”. Add a `- Name:` line.");
  }

  const toneParts: string[] = [];
  if (identity?.vibe?.trim()) toneParts.push(`## Identity vibe\n${identity.vibe.trim()}`);
  if (soul?.toneOfVoice?.trim()) toneParts.push(soul.toneOfVoice);

  const specialParts: string[] = [];
  if (soul?.soulContinuity) specialParts.push(soul.soulContinuity);
  if (user?.context) {
    specialParts.push(`## User context (from USER.md)\n\n${user.context}`);
  } else if (user?.full && !user.relationship) {
    specialParts.push(`## User context (from USER.md)\n\n${user.full}`);
  }
  if (bundle.journal?.trim()) {
    specialParts.push(`## Journal (from OpenClaw JOURNAL.md)\n\n${bundle.journal.trim()}`);
    warnings.push(
      "JOURNAL.md was imported into special instructions. For long-term memory, consider Memory Anchor or a fresh chat summary.",
    );
  }
  if (bundle.memory?.trim()) {
    specialParts.push(`## Memory notes (from OpenClaw MEMORY.md)\n\n${bundle.memory.trim()}`);
  }
  if (bundle.tools?.trim()) {
    specialParts.push(`## Tools (from OpenClaw TOOLS.md)\n\n${bundle.tools.trim()}`);
  }
  if (bundle.heartbeat?.trim()) {
    specialParts.push(`## Heartbeat (from OpenClaw HEARTBEAT.md)\n\n${bundle.heartbeat.trim()}`);
  }
  if (bundle.agents?.trim()) {
    specialParts.push(`## Agents (from OpenClaw AGENTS.md)\n\n${bundle.agents.trim()}`);
  }

  const avatarParts: string[] = [];
  if (identity?.creature?.trim()) avatarParts.push(identity.creature.trim());
  if (identity?.avatar?.trim()) avatarParts.push(identity.avatar.trim());

  const profile: PersonalityProfile = {
    id: newId(),
    profileName: `OpenClaw · ${companionName}`,
    companionName,
    corePersonality: soul?.corePersonality?.trim() ?? "",
    toneOfVoice: joinBlocks(toneParts),
    backgroundStory: buildBackgroundStory(identity?.creature ?? "", identity?.emoji ?? ""),
    coreValues: soul?.coreValues?.trim() ?? "",
    relationshipStyle: user?.relationship
      ? `## How to relate to the user\n\n${user.relationship}`
      : "",
    specialInstructions: joinBlocks(specialParts),
    avatarDescription: avatarParts.length ? joinBlocks(avatarParts) : null,
  };

  if (!profileLooksNonEmpty(profile)) {
    warnings.push("Mapped profile fields are mostly empty — check that markdown files use ## sections or OpenClaw bullets.");
  }

  return {
    profile,
    filesFound,
    unrecognizedFileNames: [],
    warnings,
    missingRecommended,
  };
}

/** Short summary for import preview UI. */
export function previewFieldSummary(value: string, max = 120): string {
  const t = value.trim().replace(/\s+/g, " ");
  if (!t) return "(empty)";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Build one {@link PersonalityProfile} from uploaded OpenClaw markdown files (any subset).
 */
export function openclawFilesToProfile(files: { fileName: string; text: string }[]): PersonalityProfile {
  const { bundle, unrecognizedFileNames } = buildOpenclawBundle(files);
  const preview = openclawBundleToProfile(bundle);
  if (unrecognizedFileNames.length) {
    preview.warnings.push(
      `Unrecognized markdown files (skipped): ${unrecognizedFileNames.join(", ")}`,
    );
  }
  return preview.profile;
}

/**
 * Full import preview (mapping + warnings) before committing to personality.json.
 */
export function previewOpenclawImport(files: { fileName: string; text: string }[]): OpenclawImportPreview {
  const { bundle, unrecognizedFileNames } = buildOpenclawBundle(files);
  const preview = openclawBundleToProfile(bundle);
  preview.unrecognizedFileNames = unrecognizedFileNames;
  if (unrecognizedFileNames.length) {
    preview.warnings.push(
      `Unrecognized markdown files (skipped): ${unrecognizedFileNames.join(", ")}`,
    );
  }
  return preview;
}

/** Append imported profiles; regenerates ids when they collide with existing ones. */
export function appendImportedProfiles(base: PersonalityFile, incoming: PersonalityProfile[]): PersonalityFile {
  const used = new Set(base.profiles.map((p) => p.id));
  const appended: PersonalityProfile[] = [];
  for (const p of incoming) {
    let id = p.id;
    let profileName = p.profileName;
    if (!id || used.has(id)) {
      id = newId();
      if (!p.profileName.includes("import")) {
        profileName = `${p.profileName} (imported)`;
      }
    }
    used.add(id);
    appended.push({ ...p, id, profileName });
  }
  const profiles = [...base.profiles, ...appended];
  const last = appended[appended.length - 1];
  return {
    ...base,
    profiles,
    activeProfileId: last?.id ?? base.activeProfileId,
  };
}
