//! In-process nested subagents for long-running companion, research, and coding work.
//!
//! Parent agents call the `task` / `spawn_subagent` tool. Children run an isolated
//! `agent_complete_with_tools` loop (no parent transcript), optionally in parallel,
//! preferring OpenRouter when configured.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::join_all;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::Semaphore;

use crate::coding::CodingTurnContext;
use crate::memory::ConversationMemory;
use crate::personality::PersonalityManager;
use crate::provider::{ChatTurn, LLMProviderEngine, ProviderError, ToolDefinition};
use crate::settings::SettingsManager;
use crate::tool_stream::ToolStreamEmitter;
use std::sync::atomic::{AtomicUsize, Ordering};

/// How many nested subagents are currently executing (across the process).
static ACTIVE_SUBAGENTS: AtomicUsize = AtomicUsize::new(0);

pub fn active_subagent_count() -> usize {
    ACTIVE_SUBAGENTS.load(Ordering::SeqCst)
}

tokio::task_local! {
    static SUBAGENT_DEPTH: u8;
}

/// Current nesting depth (0 = parent / interactive turn).
pub fn current_depth() -> u8 {
    SUBAGENT_DEPTH.try_with(|d| *d).unwrap_or(0)
}

pub fn is_subagent_tool_name(name: &str) -> bool {
    matches!(name.trim(), "task" | "spawn_subagent")
}

pub fn tool_definition() -> ToolDefinition {
    ToolDefinition {
        name: "task".into(),
        description: Some(
            "Spawn one or more Persistent Sage subagents to work a scoped mission autonomously \
             (research, companion work, or coding). Prefer this for long-running or parallel work. \
             Pass `prompt` for a single child, or `prompts` (array) to run several in parallel. \
             Optional `mode`: companion | research | coding | auto. Optional `model` (OpenRouter id). \
             From a coding-mode turn, children are always coding-scoped (companion/research packs are \
             refused) so repo work cannot escalate to Google/web/Moltbook/DB tools. \
             Returns a condensed summary from each child — not the full child transcript. \
             Alias: spawn_subagent."
                .into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Mission for a single subagent"
                },
                "prompts": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Multiple missions to run in parallel"
                },
                "mode": {
                    "type": "string",
                    "enum": ["auto", "companion", "research", "coding"],
                    "description": "Tool pack for the child. auto = inherit parent (coding if in coding mode, else companion). Ignored escalation: coding parents always spawn coding children."
                },
                "model": {
                    "type": "string",
                    "description": "Optional OpenRouter model id override for this child"
                }
            },
            "required": []
        }),
    }
}

pub fn tool_definitions() -> Vec<ToolDefinition> {
    let primary = tool_definition();
    let mut alias = ToolDefinition {
        name: "spawn_subagent".into(),
        description: primary.description.clone(),
        parameters: primary.parameters.clone(),
    };
    // keep description pointing at the primary name
    alias.description = Some(
        "Alias for `task`. Spawn nested Persistent Sage subagents (see `task` tool)."
            .into(),
    );
    vec![primary, alias]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubagentMode {
    Companion,
    Research,
    Coding,
}

impl SubagentMode {
    /// Resolve the requested child mode.
    ///
    /// Coding-mode parents are repo-scoped and deliberately omit Google / web / Moltbook /
    /// DB / companion memory tools. Explicit `mode: companion` or `research` must not rebuild
    /// those packs (or clear `coding_ctx` so a nested `task` can escalate further).
    fn parse(raw: &str, parent_is_coding: bool) -> Self {
        if parent_is_coding {
            return Self::Coding;
        }
        match raw.trim().to_ascii_lowercase().as_str() {
            "research" => Self::Research,
            "coding" => Self::Coding,
            "companion" => Self::Companion,
            _ => Self::Companion,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Companion => "companion",
            Self::Research => "research",
            Self::Coding => "coding",
        }
    }
}

/// Host context borrowed from the parent tool round.
pub struct SubagentHost<'a> {
    pub app: Option<&'a AppHandle>,
    pub http: &'a reqwest::Client,
    pub workspace_root: Option<&'a Path>,
    pub data_directory: &'a Path,
    pub database_app_data_enabled: bool,
    pub database_allow_write: bool,
    pub browser_ignore_robots: bool,
    pub personality: Option<&'a PersonalityManager>,
    pub memory_tools: Option<(&'a SettingsManager, &'a dyn ConversationMemory)>,
    pub coding_ctx: Option<&'a CodingTurnContext>,
    pub tool_stream: Option<&'a ToolStreamEmitter>,
    pub settings: &'a SettingsManager,
    pub conversation_id: &'a str,
    pub temperature: f32,
    pub max_tokens: Option<u32>,
    pub thinking_effort: Option<String>,
}

pub async fn run_task_tool(host: &SubagentHost<'_>, arguments_json: &str) -> Result<String, ProviderError> {
    if !host.settings.subagents_enabled() {
        return Err(ProviderError::Api(
            "Subagents are disabled. Enable them under Settings → Tools → Subagents.".into(),
        ));
    }

    let depth = current_depth();
    let max_depth = host.settings.subagent_max_depth();
    if depth >= max_depth {
        return Err(ProviderError::Api(format!(
            "Subagent depth limit reached ({max_depth}). Finish with available tools or return a summary."
        )));
    }

    let args: Value = serde_json::from_str(arguments_json)
        .map_err(|e| ProviderError::Api(format!("bad task tool JSON: {e}")))?;

    let mut prompts: Vec<String> = Vec::new();
    if let Some(arr) = args.get("prompts").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    prompts.push(t.to_string());
                }
            }
        }
    }
    if prompts.is_empty() {
        if let Some(s) = args.get("prompt").and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                prompts.push(t.to_string());
            }
        }
    }
    if prompts.is_empty() {
        return Err(ProviderError::Api(
            "task requires `prompt` (string) or `prompts` (string array)".into(),
        ));
    }

    let mode_raw = args
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("auto");
    let mode = SubagentMode::parse(mode_raw, host.coding_ctx.is_some());
    let model_override = args
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let max_concurrent = host.settings.subagent_max_concurrent().max(1) as usize;
    let sem = Arc::new(Semaphore::new(max_concurrent));
    let child_depth = depth + 1;

    let futs = prompts.into_iter().enumerate().map(|(i, prompt)| {
        let sem = Arc::clone(&sem);
        let model_override = model_override.clone();
        async move {
            let _permit = sem
                .acquire()
                .await
                .map_err(|e| ProviderError::Api(format!("subagent slot: {e}")))?;
            SUBAGENT_DEPTH
                .scope(child_depth, run_one_child(host, mode, &prompt, model_override.as_deref(), i + 1))
                .await
        }
    });

    let results = join_all(futs).await;
    let mut parts: Vec<String> = Vec::with_capacity(results.len());
    for (idx, res) in results.into_iter().enumerate() {
        match res {
            Ok(summary) => parts.push(format!("### Subagent {}\n{summary}", idx + 1)),
            Err(e) => parts.push(format!("### Subagent {}\nError: {e}", idx + 1)),
        }
    }
    Ok(parts.join("\n\n"))
}

async fn run_one_child(
    host: &SubagentHost<'_>,
    mode: SubagentMode,
    prompt: &str,
    model_override: Option<&str>,
    index: usize,
) -> Result<String, ProviderError> {
    let mission = truncate(prompt, 240);
    let running = ACTIVE_SUBAGENTS.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(ts) = host.tool_stream {
        let noun = if running == 1 { "subagent" } else { "subagents" };
        ts.turn_status(&format!(
            "Spawning subagent {index} ({mode}) — {running} {noun} running…",
            mode = mode.label()
        ));
        ts.start(
            "task",
            &format!("#{index} {} · {}", mode.label(), truncate(prompt, 80)),
        );
    }
    let stream_id = if let Some(app) = host.app {
        Some(crate::agent_stream::emit_generation_step_start_nested(
            app,
            None,
            &format!("subagent[{index}/{}]: {mission}", mode.label()),
            Some(current_depth()),
            Some("subagent"),
        ))
    } else {
        None
    };

    let outcome = run_one_child_inner(host, mode, prompt, model_override).await;

    let remaining = ACTIVE_SUBAGENTS.fetch_sub(1, Ordering::SeqCst).saturating_sub(1);
    if let Some(ts) = host.tool_stream {
        ts.end("task");
        if remaining > 0 {
            let noun = if remaining == 1 {
                "subagent"
            } else {
                "subagents"
            };
            ts.turn_status(&format!(
                "Subagent {index} finished — {remaining} {noun} still running…"
            ));
        } else {
            ts.turn_status("Subagent finished — waiting for model…");
        }
    }

    if let (Some(app), Some(id)) = (host.app, stream_id.as_ref()) {
        match &outcome {
            Ok(summary) => {
                crate::agent_stream::emit_generation_step_end(
                    app,
                    id,
                    true,
                    &truncate(summary, 400),
                    None,
                    None,
                );
            }
            Err(e) => {
                crate::agent_stream::emit_generation_step_end(
                    app,
                    id,
                    false,
                    &e.to_string(),
                    None,
                    None,
                );
            }
        }
    }

    outcome
}

async fn run_one_child_inner(
    host: &SubagentHost<'_>,
    mode: SubagentMode,
    prompt: &str,
    model_override: Option<&str>,
) -> Result<String, ProviderError> {
    let engine: Arc<dyn LLMProviderEngine + Send + Sync> =
        crate::provider::build_subagent_engine(host.http, host.settings, model_override)?;
    let backend = crate::chat::web_tool_backend_for_provider(engine.provider_id()).ok_or_else(|| {
        ProviderError::Api(format!(
            "Subagent provider '{}' does not support tool loops. Prefer OpenRouter / OpenAI / Anthropic / Ollama tools.",
            engine.provider_id()
        ))
    })?;

    let depth = current_depth();
    let max_depth = host.settings.subagent_max_depth();
    let allow_nested_task = depth < max_depth;
    let tools = collect_tools(host.settings, mode, host.coding_ctx.is_some(), allow_nested_task);
    if tools.is_empty() {
        return Err(ProviderError::Api(
            "No tools available for this subagent mode. Enable web/workspace/coding tools in Settings.".into(),
        ));
    }

    let system = format!(
        "You are a Persistent Sage **subagent** (mode: {}). Work autonomously until the mission is done.\n\
         - Use tools liberally. Prefer evidence over guesses.\n\
         - Do not ask the user questions; decide and proceed.\n\
         - When finished, reply with a concise final summary of findings / changes (no tool calls).\n\
         - You may spawn further subagents with `task` only if essential and within depth limits.\n\
         - Provider: {} · model: {}\n",
        mode.label(),
        engine.provider_id(),
        engine.model_info().model_id,
    );

    let messages = vec![
        ChatTurn {
            role: "system".into(),
            content: system,
            openai_message: None,
            ollama_message: None,
            anthropic_message: None,
        },
        ChatTurn {
            role: "user".into(),
            content: prompt.to_string(),
            openai_message: None,
            ollama_message: None,
            anthropic_message: None,
        },
    ];

    let round_budget = host.settings.subagent_round_budget().max(1);
    let memory_tools = match mode {
        SubagentMode::Coding => None,
        SubagentMode::Companion | SubagentMode::Research => host.memory_tools,
    };
    let coding_ctx = match mode {
        SubagentMode::Coding => host.coding_ctx,
        _ => None,
    };
    // Research: keep writes safer by disabling DB writes for the child path via flags.
    let (db_app, db_write) = match mode {
        SubagentMode::Research => (host.database_app_data_enabled, false),
        _ => (host.database_app_data_enabled, host.database_allow_write),
    };

    crate::chat::agent_complete_with_tools(
        engine.as_ref(),
        host.http,
        host.workspace_root,
        host.data_directory,
        db_app,
        db_write,
        host.browser_ignore_robots,
        host.personality,
        memory_tools,
        coding_ctx,
        host.tool_stream,
        Some(host.settings),
        host.conversation_id,
        messages,
        host.max_tokens,
        host.temperature,
        host.thinking_effort.clone(),
        backend,
        tools,
        round_budget,
    )
    .await
}

fn collect_tools(
    settings: &SettingsManager,
    mode: SubagentMode,
    parent_is_coding: bool,
    allow_nested_task: bool,
) -> Vec<ToolDefinition> {
    // Defense in depth: even if mode resolution drifts, coding parents never advertise
    // companion/research packs (Google, Moltbook, web, DB, unrestricted workspace writes).
    let mode = if parent_is_coding {
        SubagentMode::Coding
    } else {
        mode
    };
    let mut tools: Vec<ToolDefinition> = Vec::new();
    match mode {
        SubagentMode::Research => {
            if settings.agent_web_tools_enabled() {
                tools.extend(crate::agent_tools::builtin_tool_definitions());
                if settings.agent_browser_fetch_enabled() {
                    tools.push(crate::agent_tools::browser_fetch_tool_definition(
                        settings.agent_browser_ignore_robots(),
                    ));
                }
            }
            if settings.agent_workspace_enabled() {
                tools.extend(research_workspace_tools());
            }
            tools.extend(crate::memory_tools::tool_definitions());
            tools.extend(crate::weather::tool_definitions());
        }
        SubagentMode::Companion => {
            if settings.agent_web_tools_enabled() {
                tools.extend(crate::agent_tools::builtin_tool_definitions());
                if settings.agent_browser_fetch_enabled() {
                    tools.push(crate::agent_tools::browser_fetch_tool_definition(
                        settings.agent_browser_ignore_robots(),
                    ));
                }
            }
            if settings.agent_workspace_enabled() {
                tools.extend(crate::agent_tools::workspace_tool_definitions());
            }
            if settings.artifacts_enabled() {
                tools.extend(crate::projects::project_tool_definitions());
            }
            if settings.moltbook_enabled() && settings.moltbook_agent_tools_enabled() {
                tools.extend(crate::moltbook::tool_definitions());
            }
            if settings.google_enabled() && settings.google_agent_tools_enabled() {
                tools.extend(crate::google::tool_definitions(settings));
                tools.extend(crate::correspondence_sync::tool_definitions());
            }
            tools.extend(crate::weather::tool_definitions());
            if settings.agent_workspace_enabled() || settings.database_app_data_enabled() {
                tools.extend(crate::database_query::tool_definitions());
            }
            tools.extend(crate::memory_tools::tool_definitions());
        }
        SubagentMode::Coding => {
            tools.push(crate::coding_tools::repo_create_tool_definition());
            if settings.agent_coding_tools_enabled() {
                tools.extend(crate::coding_tools::search_and_patch_tool_definitions());
            }
            if settings.agent_coding_shell_enabled() {
                tools.push(crate::coding_tools::run_command_tool_definition());
            }
            if settings.agent_coding_git_enabled() {
                tools.extend(crate::coding_tools::git_tool_definitions());
            }
            if settings.agent_coding_git_remote_enabled() {
                tools.extend(crate::coding_tools::git_remote_tool_definitions());
            }
            tools.extend(crate::coding_tools::coding_notes_tool_definitions());
            tools.push(crate::coding_tools::playground_tool_definition());
            let coding_tools_on = settings.agent_coding_tools_enabled()
                || settings.agent_coding_shell_enabled()
                || settings.agent_coding_git_enabled()
                || settings.agent_coding_git_remote_enabled();
            if coding_tools_on {
                tools.extend(crate::agent_tools::workspace_tool_definitions());
            }
        }
    }
    if allow_nested_task && settings.subagents_enabled() {
        tools.extend(tool_definitions());
    }
    tools
}

fn research_workspace_tools() -> Vec<ToolDefinition> {
    crate::agent_tools::workspace_tool_definitions()
        .into_iter()
        .filter(|t| t.name != "workspace_write_file")
        .collect()
}

fn truncate(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        let cut: String = t.chars().take(max.saturating_sub(1)).collect();
        format!("{cut}…")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coding_parent_cannot_escalate_to_companion_or_research() {
        // Concrete escape that this locks: coding turns omit Google/web/Moltbook/DB tools,
        // but used to honor `mode: companion` / `research` on `task`, rebuilding those packs
        // (and clearing coding_ctx so a nested task could escalate further).
        assert_eq!(SubagentMode::parse("companion", true), SubagentMode::Coding);
        assert_eq!(SubagentMode::parse("research", true), SubagentMode::Coding);
        assert_eq!(SubagentMode::parse("auto", true), SubagentMode::Coding);
        assert_eq!(SubagentMode::parse("", true), SubagentMode::Coding);
        assert_eq!(SubagentMode::parse("coding", true), SubagentMode::Coding);
    }

    #[test]
    fn non_coding_parent_honors_explicit_modes() {
        assert_eq!(
            SubagentMode::parse("companion", false),
            SubagentMode::Companion
        );
        assert_eq!(SubagentMode::parse("research", false), SubagentMode::Research);
        assert_eq!(SubagentMode::parse("coding", false), SubagentMode::Coding);
        assert_eq!(SubagentMode::parse("auto", false), SubagentMode::Companion);
    }
}
