//! Saved one-click workflows (recipes) for OpenSage — stored in `{data_dir}/recipes.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::artifacts::ARTIFACT_SYSTEM_APPENDIX;
use crate::chat::{execute_chat_turn, ChatTurnOptions};
use crate::NovaState;

const RECIPES_FILE: &str = "recipes.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub requires_browser_fetch: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipesFile {
    #[serde(default)]
    recipes: Vec<Recipe>,
}

fn recipes_path(data_dir: &Path) -> PathBuf {
    data_dir.join(RECIPES_FILE)
}

pub fn default_recipes() -> Vec<Recipe> {
    vec![
        Recipe {
            id: "daily-summary".into(),
            name: "Daily summary".into(),
            description: "Summarize today’s thread and suggest next steps.".into(),
            prompt: "Review this conversation and produce a concise daily summary with bullet priorities. \
                      If helpful, include a markdown or html artifact with the summary."
                .into(),
            requires_browser_fetch: false,
        },
        Recipe {
            id: "weekly-plan".into(),
            name: "Weekly plan".into(),
            description: "Draft a weekly plan from memory and recent chat.".into(),
            prompt: "Draft a weekly plan that fits the user’s real constraints.\n\n\
                     Output requirements:\n\
                     - Do NOT dump a large markdown table into the plain-text chat.\n\
                     - Always include exactly ONE artifact block.\n\
                     - Use type \"html\" for the artifact.\n\
                     - The HTML artifact must include:\n\
                       1) A clean, readable weekly schedule table (days x categories)\n\
                       2) A compact visual summary (no JS). Use simple HTML+CSS bars for weekly totals by category.\n\
                     - Keep the non-artifact chat text to a short explanation + 3–6 bullet next steps.\n\n\
                     Data guidance:\n\
                     - If the user has not provided hour allocations, propose reasonable defaults and label them as placeholders.\n\
                     - Ensure daily totals are sane (e.g. <= 24) and note assumptions.\n\
                     - Use consistent category names across the table and bars."
                .into(),
            requires_browser_fetch: false,
        },
        Recipe {
            id: "workspace-audit".into(),
            name: "Workspace audit".into(),
            description: "Scan the agent workspace and return a cited report artifact.".into(),
            prompt: "Audit files in the agent workspace. List findings with file citations in the artifact \
                      citations array. Use type markdown or html for the report body."
                .into(),
            requires_browser_fetch: false,
        },
        Recipe {
            id: "start-project".into(),
            name: "Start a project".into(),
            description: "Begin a flexible collaborative project (budget, plan, report).".into(),
            prompt: "The user wants to start a new collaborative project. Ask what they are working on \
                      (budget, marketing plan, audit, etc.) and offer two intake paths:\n\
                      (A) upload/reference files in the agent workspace, or (B) a `form` artifact to collect details.\n\
                      Do not build the full deliverable until they choose and provide input. \
                      When creating a project, use project_create with a clear id slug."
                .into(),
            requires_browser_fetch: false,
        },
    ]
}

pub fn load_recipes(data_dir: &Path) -> Result<Vec<Recipe>, String> {
    let path = recipes_path(data_dir);
    if !path.is_file() {
        let defaults = default_recipes();
        save_recipes(data_dir, &defaults)?;
        return Ok(defaults);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut file: RecipesFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if file.recipes.is_empty() {
        let defaults = default_recipes();
        save_recipes(data_dir, &defaults)?;
        return Ok(defaults);
    }

    // Light-touch “defaults drift” updater:
    // - Add missing default recipes
    // - Update known-bad legacy prompts when they match older shipped text
    let defaults = default_recipes();
    for def in defaults {
        match file.recipes.iter_mut().find(|r| r.id == def.id) {
            None => file.recipes.push(def),
            Some(existing) => {
                if existing.id == "weekly-plan"
                    && existing
                        .prompt
                        .contains("Using memory anchors and recent messages, draft a weekly plan")
                {
                    existing.prompt = def.prompt;
                    existing.description = def.description;
                }
            }
        }
    }
    // Persist only if we actually changed anything (simple heuristic).
    // If serialization fails, still return the in-memory list.
    let _ = save_recipes(data_dir, &file.recipes);
    Ok(file.recipes)
}

pub fn save_recipes(data_dir: &Path, recipes: &[Recipe]) -> Result<(), String> {
    let path = recipes_path(data_dir);
    let file = RecipesFile {
        recipes: recipes.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRunResult {
    pub ok: bool,
    pub reply: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn run_recipe(
    app: &AppHandle,
    state: &NovaState,
    recipe_id: &str,
    conversation_id: &str,
) -> RecipeRunResult {
    let recipes = match load_recipes(&state.data_directory) {
        Ok(r) => r,
        Err(e) => {
            return RecipeRunResult {
                ok: false,
                reply: None,
                error: Some(e),
            };
        }
    };

    let Some(recipe) = recipes.iter().find(|r| r.id == recipe_id) else {
        return RecipeRunResult {
            ok: false,
            reply: None,
            error: Some(format!("unknown recipe: {recipe_id}")),
        };
    };

    if recipe.requires_browser_fetch && !state.settings.agent_browser_fetch_enabled() {
        return RecipeRunResult {
            ok: false,
            reply: None,
            error: Some(
                "This recipe needs Browser Page Fetch — enable it in Settings → Tools.".into(),
            ),
        };
    }

    let pid = state.personality.active_profile_id();
    let mut prompt = recipe.prompt.clone();
    if state.settings.artifacts_enabled() {
        prompt.push_str("\n\n");
        prompt.push_str(ARTIFACT_SYSTEM_APPENDIX);
    }

    match execute_chat_turn(
        app,
        state,
        conversation_id,
        &prompt,
        &pid,
        None,
        ChatTurnOptions {
            emit_stream: true,
            persist_user_message: false,
            persist_assistant_message: true,
            enable_tools: true,
            assistant_reply_prefix: Some(format!("Recipe: {} — ", recipe.name)),
            ephemeral_user_note: crate::chat::EphemeralUserNote::None,
        },
    )
    .await
    {
        Ok(reply) => RecipeRunResult {
            ok: true,
            reply: Some(reply),
            error: None,
        },
        Err(e) => RecipeRunResult {
            ok: false,
            reply: None,
            error: Some(e),
        },
    }
}
