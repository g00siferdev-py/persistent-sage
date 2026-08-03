//! Token estimation and context window tracking for UI display.
//!
//! Uses a simple approximation (4 characters per token) for fast estimation.

use serde::{Deserialize, Serialize};

/// Approximate tokens for a piece of text (4 chars per token).
pub fn estimate_tokens(text: &str) -> u32 {
    let chars = text.len();
    (chars / 4) as u32
}

/// Context window sizes for known models (in tokens).
pub fn context_window_for_model(provider: &str, model: &str) -> u32 {
    let provider_lc = provider.to_lowercase();
    let model_lc = model.to_lowercase();

    // OpenAI models
    if provider_lc == "openai" || provider_lc == "xai" || provider_lc == "openrouter" {
        if model_lc.contains("gpt-4o-mini") {
            return 128_000;
        }
        if model_lc.contains("gpt-4o") || model_lc.contains("gpt-4-turbo") {
            return 128_000;
        }
        if model_lc.contains("gpt-4") {
            return 8_192;
        }
        if model_lc.contains("gpt-3.5") {
            if model_lc.contains("16k") || model_lc.contains("1106") {
                return 16_384;
            }
            return 4_096;
        }
        if model_lc.contains("grok") {
            return 128_000;
        }
        return 128_000;
    }

    // Anthropic models
    if provider_lc == "anthropic" {
        if model_lc.contains("claude-3-opus") {
            return 200_000;
        }
        if model_lc.contains("claude-3-sonnet") || model_lc.contains("claude-3-haiku") {
            return 200_000;
        }
        if model_lc.contains("claude-3.5-sonnet") {
            return 200_000;
        }
        return 100_000;
    }

    // Gemini models
    if provider_lc == "gemini" {
        if model_lc.contains("gemini-1.5-pro") || model_lc.contains("gemini-1.5-flash") {
            return 1_000_000;
        }
        if model_lc.contains("gemini-1.0-pro") {
            return 32_000;
        }
        if model_lc.contains("gemini-2") {
            return 1_000_000;
        }
        return 1_000_000;
    }

    // Ollama models
    if provider_lc == "ollama" {
        if model_lc.contains("llama3") || model_lc.contains("llama-3") {
            return 128_000;
        }
        if model_lc.contains("mistral") || model_lc.contains("mixtral") {
            return 32_000;
        }
        if model_lc.contains("codellama") {
            return 16_000;
        }
        if model_lc.contains("qwen") || model_lc.contains("kimi") {
            return 128_000;
        }
        if model_lc.contains("phi") || model_lc.contains("phi3") {
            return 128_000;
        }
        if model_lc.contains("gemma") {
            return 8_000;
        }
        return 4_096;
    }

    // Default fallback
    128_000
}

/// Token context information for a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenContextInfo {
    /// Estimated tokens used by current conversation messages.
    pub tokens_used: u32,
    /// Maximum context window for the active model.
    pub context_window: u32,
    /// Percentage of context used (0-100).
    pub percent_used: u32,
    /// Human-readable display string like "128k / 256k (50%)".
    pub display_string: String,
    /// Provider ID.
    pub provider_id: String,
    /// Model ID.
    pub model_id: String,
}

impl TokenContextInfo {
    /// Create token context info from messages and model config.
    pub fn from_messages(
        messages: &[(String, String)],
        provider_id: &str,
        model_id: &str,
    ) -> Self {
        let total_chars: usize = messages.iter().map(|(_, content)| content.len()).sum();
        let tokens_used = (total_chars / 4) as u32;
        let context_window = context_window_for_model(provider_id, model_id);
        let percent_used = ((tokens_used as u64 * 100) / context_window.max(1) as u64) as u32;
        let percent_used = percent_used.min(100);

        let display_string = format!("{}k / {}k ({}%)", tokens_used / 1000, context_window / 1000, percent_used);

        Self {
            tokens_used,
            context_window,
            percent_used,
            display_string,
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
        }
    }
}
