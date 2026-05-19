//! Agent tools to read/update the active companion profile in `personality.json`.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::personality::{PersonalityManager, PersonalityProfile};
use crate::provider::{ProviderError, ToolDefinition};

const FIELD_MAX_CHARS: usize = 50_000;

fn tool_err(msg: impl Into<String>) -> ProviderError {
    ProviderError::Api(msg.into())
}

fn check_field_len(label: &str, s: &str) -> Result<(), ProviderError> {
    if s.chars().count() > FIELD_MAX_CHARS {
        return Err(tool_err(format!(
            "{label} exceeds {FIELD_MAX_CHARS} characters"
        )));
    }
    Ok(())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonalityUpdateArgs {
    profile_name: Option<String>,
    companion_name: Option<String>,
    core_personality: Option<String>,
    tone_of_voice: Option<String>,
    background_story: Option<String>,
    core_values: Option<String>,
    relationship_style: Option<String>,
    special_instructions: Option<String>,
    avatar_description: Option<Value>,
}

fn profile_to_json(p: &PersonalityProfile, generated_prompt: &str) -> Value {
    json!({
        "id": p.id,
        "profileName": p.profile_name,
        "companionName": p.companion_name,
        "corePersonality": p.core_personality,
        "toneOfVoice": p.tone_of_voice,
        "backgroundStory": p.background_story,
        "coreValues": p.core_values,
        "relationshipStyle": p.relationship_style,
        "specialInstructions": p.special_instructions,
        "avatarDescription": p.avatar_description,
        "generatedSystemPromptPreview": generated_prompt.chars().take(1200).collect::<String>(),
    })
}

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "personality_get".into(),
            description: Some(
                "Read the active companion personality profile (the preset used in this chat). \
                 Returns JSON with all persona fields and a short preview of the generated system prompt."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "personality_update".into(),
            description: Some(
                "Update fields on the active companion personality profile and save to personality.json. \
                 Only include fields you intend to change. Use when the user asks you to adjust your \
                 personality, tone, values, relationship style, or special instructions—not for casual chat. \
                 Changes persist on disk and apply to the rest of this conversation immediately."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "profileName": { "type": "string", "description": "Preset label in Settings" },
                    "companionName": { "type": "string", "description": "Name shown in chat" },
                    "corePersonality": { "type": "string" },
                    "toneOfVoice": { "type": "string" },
                    "backgroundStory": { "type": "string" },
                    "coreValues": { "type": "string" },
                    "relationshipStyle": { "type": "string" },
                    "specialInstructions": { "type": "string" },
                    "avatarDescription": {
                        "type": ["string", "null"],
                        "description": "Visual/avatar note, or null to clear"
                    }
                },
                "additionalProperties": false
            }),
        },
    ]
}

pub fn personality_system_hint() -> &'static str {
    "\n\n## Personality self-edit (enabled)\n\n\
     You may use **personality_get** to read your saved persona and **personality_update** to change the \
     active profile when the user asks you to adjust how you behave. Do not rewrite your personality \
     without a clear user request. Saved changes update this chat's system instructions immediately.\n"
}

/// Replace the persona block at the start of the system message; keep the memory briefing tail.
pub fn refresh_system_persona_in_messages(
    messages: &mut [crate::provider::ChatTurn],
    personality: &PersonalityManager,
) {
    let Some(sys) = messages.first_mut().filter(|m| m.role == "system") else {
        return;
    };
    let persona = personality.system_prompt_prefix();
    const MARKER: &str = "\n\n---\n\n# Memory & session context\n\n";
    if let Some(idx) = sys.content.find(MARKER) {
        let tail = sys.content[idx..].to_string();
        sys.content = if persona.trim().is_empty() {
            tail.trim_start_matches('\n').to_string()
        } else {
            format!("{}{}", persona.trim(), tail)
        };
    } else if !persona.trim().is_empty() {
        sys.content = persona;
    }
}

pub fn run_personality_tool(
    personality: &PersonalityManager,
    name: &str,
    arguments_json: &str,
) -> Result<(String, bool), ProviderError> {
    match name.trim() {
        "personality_get" => {
            let snap = personality
                .snapshot()
                .map_err(|e| tool_err(e.to_string()))?;
            let active = snap
                .file
                .profiles
                .iter()
                .find(|p| p.id == snap.file.active_profile_id)
                .or_else(|| snap.file.profiles.first())
                .ok_or_else(|| tool_err("no personality profiles"))?;
            let body = serde_json::to_string_pretty(&json!({
                "ok": true,
                "activeProfileId": snap.file.active_profile_id,
                "profile": profile_to_json(active, &snap.generated_system_prompt),
            }))
            .map_err(|e| tool_err(e.to_string()))?;
            Ok((body, false))
        }
        "personality_update" => {
            let v: Value = serde_json::from_str(arguments_json)
                .map_err(|e| tool_err(format!("bad tool JSON: {e}")))?;
            let args: PersonalityUpdateArgs = serde_json::from_value(v)
                .map_err(|e| tool_err(format!("invalid personality_update args: {e}")))?;

            if let Some(ref s) = args.profile_name {
                check_field_len("profileName", s.trim())?;
                if s.trim().is_empty() {
                    return Err(tool_err("profileName cannot be empty"));
                }
            }
            if let Some(ref s) = args.companion_name {
                check_field_len("companionName", s.trim())?;
                if s.trim().is_empty() {
                    return Err(tool_err("companionName cannot be empty"));
                }
            }
            for (key, val) in [
                ("corePersonality", args.core_personality.as_deref()),
                ("toneOfVoice", args.tone_of_voice.as_deref()),
                ("backgroundStory", args.background_story.as_deref()),
                ("coreValues", args.core_values.as_deref()),
                ("relationshipStyle", args.relationship_style.as_deref()),
                ("specialInstructions", args.special_instructions.as_deref()),
            ] {
                if let Some(s) = val {
                    check_field_len(key, s)?;
                }
            }

            let avatar_patch = match args.avatar_description.as_ref() {
                None => None,
                Some(Value::Null) => Some(None),
                Some(Value::String(s)) => {
                    let t = s.trim();
                    if t.is_empty() {
                        Some(None)
                    } else {
                        check_field_len("avatarDescription", t)?;
                        Some(Some(t.to_string()))
                    }
                }
                _ => {
                    return Err(tool_err(
                        "avatarDescription must be a string or null",
                    ));
                }
            };

            let has_scalar = args.profile_name.is_some()
                || args.companion_name.is_some()
                || args.core_personality.is_some()
                || args.tone_of_voice.is_some()
                || args.background_story.is_some()
                || args.core_values.is_some()
                || args.relationship_style.is_some()
                || args.special_instructions.is_some();
            if !has_scalar && avatar_patch.is_none() {
                return Err(tool_err(
                    "personality_update: provide at least one field to change",
                ));
            }

            let snap = personality
                .patch_active_profile(
                    args.profile_name.as_deref().map(str::trim),
                    args.companion_name.as_deref().map(str::trim),
                    args.core_personality.as_deref(),
                    args.tone_of_voice.as_deref(),
                    args.background_story.as_deref(),
                    args.core_values.as_deref(),
                    args.relationship_style.as_deref(),
                    args.special_instructions.as_deref(),
                    avatar_patch,
                )
                .map_err(|e| tool_err(e.to_string()))?;

            let active = snap
                .file
                .profiles
                .iter()
                .find(|p| p.id == snap.file.active_profile_id)
                .or_else(|| snap.file.profiles.first())
                .ok_or_else(|| tool_err("no personality profiles"))?;

            let body = serde_json::to_string_pretty(&json!({
                "ok": true,
                "saved": true,
                "message": "Active personality profile updated and saved to personality.json.",
                "activeProfileId": snap.file.active_profile_id,
                "profile": profile_to_json(active, &snap.generated_system_prompt),
            }))
            .map_err(|e| tool_err(e.to_string()))?;
            Ok((body, true))
        }
        other => Err(tool_err(format!("unknown personality tool: {other}"))),
    }
}
