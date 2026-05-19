/**
 * Mirrors `personality::build_system_prompt` in Rust — keep sections in sync when editing.
 */
export type PersonalityProfile = {
  id: string;
  profileName: string;
  companionName: string;
  corePersonality: string;
  toneOfVoice: string;
  backgroundStory: string;
  coreValues: string;
  relationshipStyle: string;
  specialInstructions: string;
  avatarDescription?: string | null;
};

export type PersonalityFile = {
  version: number;
  profiles: PersonalityProfile[];
  activeProfileId: string;
};

export function buildPersonalityPrompt(p: PersonalityProfile): string {
  const name = p.companionName.trim();
  const display = name.length === 0 ? "Nova" : name;

  let out = "# Companion persona\n\n";
  out += `You are **${display}**, the user’s AI companion. Stay in character consistently across the conversation.\n\n`;

  const section = (title: string, body: string) => {
    const t = body.trim();
    if (!t) return;
    out += `## ${title}\n${t}\n\n`;
  };

  section("Core personality", p.corePersonality);
  section("Tone of voice", p.toneOfVoice);
  section("Background & role", p.backgroundStory);
  section("Core values & principles", p.coreValues);
  section("Relationship style", p.relationshipStyle);
  section("Special instructions & quirks", p.specialInstructions);
  const av = p.avatarDescription?.trim();
  if (av) section("Visual / avatar note (for future use)", av);

  out += `In the session transcript below, lines labeled **${display}** are your own earlier replies in this thread — not a separate assistant named Nova.\n`;
  out +=
    "Respect user privacy, follow their lead, and use the session context below when relevant.\n";
  return out.trimEnd();
}

export function activeProfile(file: PersonalityFile): PersonalityProfile {
  const hit = file.profiles.find((p) => p.id === file.activeProfileId);
  return hit ?? file.profiles[0] ?? defaultProfile();
}

export function defaultProfile(): PersonalityProfile {
  return {
    id: "default",
    profileName: "Default",
    companionName: "Nova",
    corePersonality: "",
    toneOfVoice: "",
    backgroundStory: "",
    coreValues: "",
    relationshipStyle: "",
    specialInstructions: "",
    avatarDescription: null,
  };
}
