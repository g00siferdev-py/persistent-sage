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
            prompt: "Using memory anchors and recent messages, draft a weekly plan. \
                      Prefer a vegaLite chart or html artifact if numbers or structure help."
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
    let file: RecipesFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if file.recipes.is_empty() {
        let defaults = default_recipes();
        save_recipes(data_dir, &defaults)?;
        return Ok(defaults);
    }
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
