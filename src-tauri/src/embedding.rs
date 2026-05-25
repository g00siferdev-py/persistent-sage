//! Text embeddings for semantic memory recall (OpenAI + Ollama `/api/embed`).

use serde::Deserialize;
use serde_json::json;
use thiserror::Error;

use crate::settings::SettingsManager;

#[derive(Debug, Error)]
pub enum EmbeddingError {
    #[error("provider: {0}")]
    Provider(String),

    #[error("http: {0}")]
    Http(#[from] reqwest::Error),

    #[error("parse: {0}")]
    Parse(String),

    #[error("unsupported provider for embeddings: {0}")]
    UnsupportedProvider(String),
}

#[derive(Debug, Clone)]
pub struct EmbeddingSpec {
    pub provider_id: String,
    pub model: String,
    pub openai_base_url: Option<String>,
    pub ollama_base_url: Option<String>,
    pub openai_api_key: Option<String>,
    pub ollama_bearer: Option<String>,
}

/// BLOB layout: little-endian `u32` dimensions + `dim * 4` bytes of f32 LE.
pub fn serialize_embedding(vec: &[f32]) -> Vec<u8> {
    let dim = vec.len() as u32;
    let mut out = dim.to_le_bytes().to_vec();
    for v in vec {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

pub fn deserialize_embedding(blob: &[u8]) -> Option<Vec<f32>> {
    if blob.len() < 4 {
        return None;
    }
    let dim = u32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    let need = 4 + dim * 4;
    if blob.len() < need || dim == 0 || dim > 4096 {
        return None;
    }
    let mut out = Vec::with_capacity(dim);
    for i in 0..dim {
        let off = 4 + i * 4;
        let b = [blob[off], blob[off + 1], blob[off + 2], blob[off + 3]];
        out.push(f32::from_le_bytes(b));
    }
    Some(out)
}

#[must_use]
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na <= 0.0 || nb <= 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

pub fn resolve_embedding_spec(settings: &SettingsManager) -> Result<EmbeddingSpec, EmbeddingError> {
    let provider = settings.selected_provider();
    let custom = settings.embedding_model().trim().to_string();
    match provider.as_str() {
        "openai" => {
            let model = if custom.is_empty() {
                "text-embedding-3-small".into()
            } else {
                custom
            };
            let api_key = settings
                .decrypt_api_key("openai")
                .map_err(|e| EmbeddingError::Provider(e.to_string()))?
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| {
                    EmbeddingError::Provider("OpenAI API key required for embeddings".into())
                })?;
            Ok(EmbeddingSpec {
                provider_id: "openai".into(),
                model,
                openai_base_url: Some(settings.openai_base_url()),
                ollama_base_url: None,
                openai_api_key: Some(api_key),
                ollama_bearer: None,
            })
        }
        "ollama" | "ollama_cloud" => {
            let model = if custom.is_empty() {
                "nomic-embed-text".into()
            } else {
                custom
            };
            let (base, bearer) = if provider == "ollama_cloud" {
                let token = settings
                    .decrypt_api_key("ollama")
                    .map_err(|e| EmbeddingError::Provider(e.to_string()))?
                    .filter(|s| !s.trim().is_empty())
                    .ok_or_else(|| {
                        EmbeddingError::Provider("Ollama Cloud API key required".into())
                    })?;
                ("https://ollama.com".to_string(), Some(token))
            } else {
                (settings.ollama_base_url(), None)
            };
            Ok(EmbeddingSpec {
                provider_id: provider,
                model,
                openai_base_url: None,
                ollama_base_url: Some(base),
                openai_api_key: None,
                ollama_bearer: bearer,
            })
        }
        "anthropic" => {
            // Anthropic has no embeddings API — use local Ollama embedder when available.
            let model = if custom.is_empty() {
                "nomic-embed-text".into()
            } else {
                custom
            };
            Ok(EmbeddingSpec {
                provider_id: "ollama".into(),
                model,
                openai_base_url: None,
                ollama_base_url: Some(settings.ollama_base_url()),
                openai_api_key: None,
                ollama_bearer: None,
            })
        }
        other => Err(EmbeddingError::UnsupportedProvider(other.to_string())),
    }
}

pub async fn embed_texts(
    http: &reqwest::Client,
    spec: &EmbeddingSpec,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    match spec.provider_id.as_str() {
        "openai" => embed_openai(http, spec, texts).await,
        "ollama" | "ollama_cloud" => embed_ollama(http, spec, texts).await,
        id => Err(EmbeddingError::UnsupportedProvider(id.to_string())),
    }
}

pub async fn embed_one(
    http: &reqwest::Client,
    spec: &EmbeddingSpec,
    text: &str,
) -> Result<Vec<f32>, EmbeddingError> {
    let mut v = embed_texts(http, spec, &[text.to_string()]).await?;
    v.pop()
        .ok_or_else(|| EmbeddingError::Parse("empty embedding response".into()))
}

#[derive(Debug, Deserialize)]
struct OpenAIEmbeddingResponse {
    data: Vec<OpenAIEmbeddingItem>,
}

#[derive(Debug, Deserialize)]
struct OpenAIEmbeddingItem {
    embedding: Vec<f32>,
}

async fn embed_openai(
    http: &reqwest::Client,
    spec: &EmbeddingSpec,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    let base = spec
        .openai_base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1")
        .trim_end_matches('/');
    let key = spec
        .openai_api_key
        .as_deref()
        .ok_or_else(|| EmbeddingError::Provider("missing OpenAI key".into()))?;
    let url = format!("{base}/embeddings");
    let body = json!({
        "model": spec.model,
        "input": texts,
    });
    let resp = http
        .post(&url)
        .header("Authorization", format!("Bearer {key}"))
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(EmbeddingError::Provider(format!(
            "OpenAI embeddings HTTP {status}: {err_body}"
        )));
    }
    let parsed: OpenAIEmbeddingResponse = resp
        .json()
        .await
        .map_err(|e| EmbeddingError::Parse(e.to_string()))?;
    if parsed.data.len() != texts.len() {
        return Err(EmbeddingError::Parse(format!(
            "expected {} embeddings, got {}",
            texts.len(),
            parsed.data.len()
        )));
    }
    Ok(parsed.data.into_iter().map(|d| d.embedding).collect())
}

#[derive(Debug, Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

async fn embed_ollama(
    http: &reqwest::Client,
    spec: &EmbeddingSpec,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    let base = spec
        .ollama_base_url
        .as_deref()
        .unwrap_or("http://127.0.0.1:11434")
        .trim_end_matches('/');
    let url = format!("{base}/api/embed");
    let body = json!({
        "model": spec.model,
        "input": texts,
    });
    let mut req = http.post(&url).json(&body);
    if let Some(t) = &spec.ollama_bearer {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(EmbeddingError::Provider(format!(
            "Ollama embed HTTP {status}: {err_body}"
        )));
    }
    let parsed: OllamaEmbedResponse = resp
        .json()
        .await
        .map_err(|e| EmbeddingError::Parse(e.to_string()))?;
    if parsed.embeddings.len() != texts.len() {
        return Err(EmbeddingError::Parse(format!(
            "expected {} embeddings, got {}",
            texts.len(),
            parsed.embeddings.len()
        )));
    }
    Ok(parsed.embeddings)
}
