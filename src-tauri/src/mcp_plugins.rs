//! MCP (Model Context Protocol) plugin support for Persistent Sage agents.
//!
//! Drop Claude Desktop MCP configs or Claude Code plugin folders into `{data_dir}/plugins/`:
//!
//! - `plugins/claude_desktop_config.json` — same format as Claude Desktop (`mcpServers` map)
//! - `plugins/<plugin-name>/` — Claude plugin folder with `.mcp.json` or `.claude-plugin/plugin.json`
//! - `plugins/servers/*.json` — individual server config snippets
//!
//! When enabled in Settings, MCP tools are exposed to the agent with names like
//! `mcp_<server>_<tool>` (server and tool segments sanitized to snake_case).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

use crate::agent_tools::tool_err;
use crate::provider::{ProviderError, ToolDefinition};

const MCP_TOOL_PREFIX: &str = "mcp_";
const MCP_INIT_TIMEOUT_SECS: u64 = 30;
const MCP_CALL_TIMEOUT_SECS: u64 = 120;
const MCP_MAX_SERVERS: usize = 32;
const MCP_MAX_TOOLS_PER_SERVER: usize = 64;

static MCP_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Deserialize)]
struct McpServerConfig {
    #[serde(default)]
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default, rename = "type")]
    transport_type: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonRpcResponse {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonRpcError {
    #[serde(default)]
    message: String,
    #[serde(default)]
    code: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpPluginStatus {
    pub name: String,
    pub enabled: bool,
    pub connected: bool,
    pub tool_count: usize,
    pub error: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone)]
struct ResolvedMcpServer {
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    source: String,
    plugin_root: Option<PathBuf>,
}

#[derive(Debug)]
struct McpRegisteredTool {
    server_name: String,
    tool_name: String,
    definition: ToolDefinition,
}

struct McpServerConnection {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<tokio::process::ChildStdout>,
    server_name: String,
}

pub struct McpPluginManager {
    data_directory: PathBuf,
    workspace_root: PathBuf,
    servers: Vec<ResolvedMcpServer>,
    tools: Vec<McpRegisteredTool>,
    connections: Mutex<HashMap<String, Arc<Mutex<McpServerConnection>>>>,
    load_errors: Vec<String>,
}

impl McpPluginManager {
    pub fn plugins_dir(data_directory: &Path) -> PathBuf {
        data_directory.join("plugins")
    }

    pub fn ensure_plugins_dir(data_directory: &Path) -> Result<PathBuf, ProviderError> {
        let dir = Self::plugins_dir(data_directory);
        std::fs::create_dir_all(&dir).map_err(|e| tool_err(format!("create plugins dir: {e}")))?;
        let readme = dir.join("README.md");
        if !readme.exists() {
            let body = r"# Persistent Sage MCP Plugins

Drop Claude Desktop MCP servers or Claude Code plugins here. Persistent Sage loads them when **MCP plugins** is enabled in Settings → Tools.

## Claude Desktop config

Create `claude_desktop_config.json` in this folder (same format as Claude Desktop):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/folder"]
    }
  }
}
```

## Claude Code / Claude Desktop plugin folders

Copy an entire plugin directory here, e.g. `plugins/my-plugin/` containing:

- `.claude-plugin/plugin.json` (optional manifest)
- `.mcp.json` with MCP server definitions, **or** `mcpServers` inside `plugin.json`

Path placeholders are expanded automatically:

| Placeholder | Resolves to |
|-------------|-------------|
| `${CLAUDE_PLUGIN_ROOT}` | The plugin folder |
| `${CLAUDE_DATA}` | `{data_dir}/plugins/{plugin}/data` |
| `${CLAUDE_PROJECT_DIR}` | Persistent Sage workspace root |

## Individual server files

You can also add JSON files under `plugins/servers/` — each file may contain one server entry or an `mcpServers` map.

## Requirements

- **stdio** MCP servers (`command` + `args`) are supported today.
- Remote HTTP/SSE servers declared with `"type": "http"` are skipped unless you bridge them with a local stdio proxy (e.g. `mcp-remote` via npx).
- Restart is not required after edits — start a new chat turn (or use Settings → Reload MCP plugins).

See https://modelcontextprotocol.io for server packages.
";
            let _ = std::fs::write(&readme, body);
        }
        let servers_dir = dir.join("servers");
        let _ = std::fs::create_dir_all(&servers_dir);
        Ok(dir)
    }

    pub fn load(data_directory: &Path, workspace_root: &Path) -> Self {
        let _ = Self::ensure_plugins_dir(data_directory);
        let mut servers = Vec::new();
        let mut load_errors = Vec::new();
        Self::load_all_configs(data_directory, workspace_root, &mut servers, &mut load_errors);
        if servers.len() > MCP_MAX_SERVERS {
            load_errors.push(format!(
                "only the first {MCP_MAX_SERVERS} MCP servers are loaded ({} configured)",
                servers.len()
            ));
            servers.truncate(MCP_MAX_SERVERS);
        }
        Self {
            data_directory: data_directory.to_path_buf(),
            workspace_root: workspace_root.to_path_buf(),
            servers,
            tools: Vec::new(),
            connections: Mutex::new(HashMap::new()),
            load_errors,
        }
    }

    pub fn load_errors(&self) -> &[String] {
        &self.load_errors
    }

    pub fn server_count(&self) -> usize {
        self.servers.len()
    }

    pub fn status(&self) -> Vec<McpPluginStatus> {
        self.servers
            .iter()
            .map(|s| {
                let tool_count = self
                    .tools
                    .iter()
                    .filter(|t| t.server_name == s.name)
                    .count();
                McpPluginStatus {
                    name: s.name.clone(),
                    enabled: true,
                    connected: tool_count > 0,
                    tool_count,
                    error: None,
                    source: s.source.clone(),
                }
            })
            .collect()
    }

    pub fn is_mcp_tool_name(name: &str) -> bool {
        name.starts_with(MCP_TOOL_PREFIX)
    }

    pub fn tool_definitions(&self) -> Vec<ToolDefinition> {
        self.tools
            .iter()
            .map(|t| t.definition.clone())
            .collect()
    }

    pub async fn discover_tools(&mut self) {
        self.tools.clear();
        let servers = self.servers.clone();
        for server in servers {
            match self.connect_and_list_tools(&server).await {
                Ok(mut defs) => {
                    if defs.len() > MCP_MAX_TOOLS_PER_SERVER {
                        defs.truncate(MCP_MAX_TOOLS_PER_SERVER);
                        self.load_errors.push(format!(
                            "MCP server `{}`: only first {MCP_MAX_TOOLS_PER_SERVER} tools loaded",
                            server.name
                        ));
                    }
                    for def in defs {
                        let tool_name = def.name.clone();
                        self.tools.push(McpRegisteredTool {
                            server_name: server.name.clone(),
                            tool_name,
                            definition: def,
                        });
                    }
                }
                Err(e) => {
                    self.load_errors
                        .push(format!("MCP server `{}`: {e}", server.name));
                }
            }
        }
    }

    pub async fn run_tool(&self, exposed_name: &str, arguments_json: &str) -> Result<String, ProviderError> {
        let reg = self
            .tools
            .iter()
            .find(|t| t.definition.name == exposed_name)
            .ok_or_else(|| tool_err(format!("unknown MCP tool `{exposed_name}`")))?;
        let args: Value = if arguments_json.trim().is_empty() || arguments_json.trim() == "{}" {
            json!({})
        } else {
            serde_json::from_str(arguments_json)
                .map_err(|e| tool_err(format!("bad MCP tool JSON: {e}")))?
        };
        let server = self
            .servers
            .iter()
            .find(|s| s.name == reg.server_name)
            .ok_or_else(|| tool_err(format!("MCP server `{}` not found", reg.server_name)))?;
        let conn = self.get_connection(server).await?;
        let mut guard = conn.lock().await;
        let result = guard
            .call_tool(&reg.tool_name, args)
            .await
            .map_err(|e| tool_err(format!("MCP tool `{}`: {e}", reg.tool_name)))?;
        Ok(format_mcp_tool_result(&result))
    }

    async fn get_connection(
        &self,
        server: &ResolvedMcpServer,
    ) -> Result<Arc<Mutex<McpServerConnection>>, ProviderError> {
        {
            let map = self.connections.lock().await;
            if let Some(c) = map.get(&server.name) {
                return Ok(c.clone());
            }
        }
        let conn = McpServerConnection::spawn(server).await?;
        let arc = Arc::new(Mutex::new(conn));
        self.connections
            .lock()
            .await
            .insert(server.name.clone(), arc.clone());
        Ok(arc)
    }

    async fn connect_and_list_tools(
        &mut self,
        server: &ResolvedMcpServer,
    ) -> Result<Vec<ToolDefinition>, ProviderError> {
        let conn = self.get_connection(server).await?;
        let mut guard = conn.lock().await;
        let tools = guard.list_tools().await?;
        let mut defs = Vec::new();
        for tool in tools {
            let raw_name = tool
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if raw_name.is_empty() {
                continue;
            }
            let description = tool
                .get("description")
                .and_then(|v| v.as_str())
                .map(String::from);
            let parameters = tool
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({"type":"object","properties":{}}));
            let exposed = mcp_exposed_tool_name(&server.name, raw_name);
            defs.push(ToolDefinition {
                name: exposed,
                description: Some(format!(
                    "[MCP:{}/{}] {}",
                    server.name,
                    raw_name,
                    description.as_deref().unwrap_or("(no description)")
                )),
                parameters,
            });
        }
        Ok(defs)
    }

    fn load_all_configs(
        data_directory: &Path,
        workspace_root: &Path,
        out: &mut Vec<ResolvedMcpServer>,
        errors: &mut Vec<String>,
    ) {
        let plugins_dir = Self::plugins_dir(data_directory);
        let desktop_cfg = plugins_dir.join("claude_desktop_config.json");
        if desktop_cfg.is_file() {
            if let Err(e) = Self::load_config_file(
                &desktop_cfg,
                None,
                "claude_desktop_config.json",
                data_directory,
                workspace_root,
                out,
            ) {
                errors.push(format!("{desktop_cfg:?}: {e}"));
            }
        }
        let servers_dir = plugins_dir.join("servers");
        if servers_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&servers_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) != Some("json") {
                        continue;
                    }
                    if let Err(e) = Self::load_config_file(
                        &path,
                        None,
                        &path.file_name().unwrap_or_default().to_string_lossy(),
                        data_directory,
                        workspace_root,
                        out,
                    ) {
                        errors.push(format!("{}: {e}", path.display()));
                    }
                }
            }
        }
        if plugins_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&plugins_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    Self::load_plugin_folder(path, data_directory, workspace_root, out, errors);
                }
            }
        }
    }

    fn load_plugin_folder(
        plugin_dir: PathBuf,
        data_directory: &Path,
        workspace_root: &Path,
        out: &mut Vec<ResolvedMcpServer>,
        errors: &mut Vec<String>,
    ) {
        let plugin_name = plugin_dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "plugin".into());
        let mcp_json = plugin_dir.join(".mcp.json");
        if mcp_json.is_file() {
            if let Err(e) = Self::load_config_file(
                &mcp_json,
                Some(&plugin_dir),
                &format!("{plugin_name}/.mcp.json"),
                data_directory,
                workspace_root,
                out,
            ) {
                errors.push(format!("{}: {e}", mcp_json.display()));
            }
        }
        let manifest = plugin_dir.join(".claude-plugin").join("plugin.json");
        if manifest.is_file() {
            if let Err(e) = Self::load_config_file(
                &manifest,
                Some(&plugin_dir),
                &format!("{plugin_name}/plugin.json"),
                data_directory,
                workspace_root,
                out,
            ) {
                errors.push(format!("{}: {e}", manifest.display()));
            }
        }
    }

    fn load_config_file(
        path: &Path,
        plugin_root: Option<&Path>,
        source_label: &str,
        data_directory: &Path,
        workspace_root: &Path,
        out: &mut Vec<ResolvedMcpServer>,
    ) -> Result<(), String> {
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let root: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let mut entries: BTreeMap<String, McpServerConfig> = BTreeMap::new();
        if let Some(map) = root.get("mcpServers").and_then(|v| v.as_object()) {
            for (k, v) in map {
                if let Ok(cfg) = serde_json::from_value::<McpServerConfig>(v.clone()) {
                    entries.insert(k.clone(), cfg);
                }
            }
        } else if let Ok(cfg) = serde_json::from_value::<McpServerConfig>(root.clone()) {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "server".into());
            entries.insert(name, cfg);
        } else if let Some(obj) = root.as_object() {
            for (k, v) in obj {
                if k == "name" || k == "version" || k == "description" {
                    continue;
                }
                if let Ok(cfg) = serde_json::from_value::<McpServerConfig>(v.clone()) {
                    if !cfg.command.is_empty() || cfg.url.is_some() {
                        entries.insert(k.clone(), cfg);
                    }
                }
            }
        }
        for (name, cfg) in entries {
            if let Some(resolved) = Self::resolve_server(
                &name,
                cfg,
                plugin_root,
                source_label,
                data_directory,
                workspace_root,
            ) {
                out.push(resolved);
            }
        }
        Ok(())
    }

    fn resolve_server(
        name: &str,
        cfg: McpServerConfig,
        plugin_root: Option<&Path>,
        source: &str,
        data_directory: &Path,
        workspace_root: &Path,
    ) -> Option<ResolvedMcpServer> {
        if let Some(t) = cfg.transport_type.as_deref() {
            if t == "http" || t == "sse" || t == "ws" {
                return None;
            }
        }
        if cfg.command.trim().is_empty() {
            if cfg.url.is_some() {
                return None;
            }
            return None;
        }
        let plugin_data = plugin_root.map(|p| p.join("data")).unwrap_or_else(|| {
            Self::plugins_dir(data_directory)
                .join(sanitize_segment(name))
                .join("data")
        });
        let expand = |s: &str| -> String {
            expand_placeholders(
                s,
                plugin_root,
                &plugin_data,
                workspace_root,
                data_directory,
            )
        };
        let command = expand(cfg.command.trim());
        let args: Vec<String> = cfg.args.iter().map(|a| expand(a)).collect();
        let env: HashMap<String, String> = cfg
            .env
            .iter()
            .map(|(k, v)| (k.clone(), expand(v)))
            .collect();
        Some(ResolvedMcpServer {
            name: sanitize_segment(name),
            command,
            args,
            env,
            source: source.to_string(),
            plugin_root: plugin_root.map(Path::to_path_buf),
        })
    }
}

fn expand_placeholders(
    input: &str,
    plugin_root: Option<&Path>,
    plugin_data: &Path,
    workspace_root: &Path,
    data_directory: &Path,
) -> String {
    let plugin_root_str = plugin_root
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    input
        .replace("${CLAUDE_PLUGIN_ROOT}", &plugin_root_str)
        .replace("${CLAUDE_DATA}", &plugin_data.to_string_lossy())
        .replace("${CLAUDE_PROJECT_DIR}", &workspace_root.to_string_lossy())
        .replace("${PERSISTENT_SAGE_DATA_DIR}", &data_directory.to_string_lossy())
        .replace("${PERSISTENT_SAGE_WORKSPACE}", &workspace_root.to_string_lossy())
}

fn sanitize_segment(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            if !out.ends_with('_') {
                out.push('_');
            }
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "server".into()
    } else {
        trimmed
    }
}

pub fn mcp_exposed_tool_name(server: &str, tool: &str) -> String {
    format!(
        "{}{}_{}",
        MCP_TOOL_PREFIX,
        sanitize_segment(server),
        sanitize_segment(tool)
    )
}

fn format_mcp_tool_result(result: &Value) -> String {
    if let Some(content) = result.get("content").and_then(|v| v.as_array()) {
        let mut parts = Vec::new();
        for block in content {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                        parts.push(text.to_string());
                    }
                }
                Some("image") | Some("audio") | Some("resource") => {
                    parts.push(format!("[{} block omitted]", block.get("type").and_then(|t| t.as_str()).unwrap_or("media")));
                }
                _ => {
                    if let Ok(s) = serde_json::to_string_pretty(block) {
                        parts.push(s);
                    }
                }
            }
        }
        if !parts.is_empty() {
            return parts.join("\n\n");
        }
    }
    if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
        return format!("MCP error: {}", serde_json::to_string(result).unwrap_or_default());
    }
    serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string())
}

impl McpServerConnection {
    async fn spawn(server: &ResolvedMcpServer) -> Result<Self, ProviderError> {
        let mut cmd = Command::new(&server.command);
        cmd.args(&server.args)
            .envs(&server.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(root) = &server.plugin_root {
            cmd.current_dir(root);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| tool_err(format!("spawn MCP `{}`: {e}", server.name)))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| tool_err(format!("MCP `{}`: no stdin", server.name)))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| tool_err(format!("MCP `{}`: no stdout", server.name)))?;
        let mut conn = Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
            server_name: server.name.clone(),
        };
        conn.initialize().await?;
        Ok(conn)
    }

    async fn initialize(&mut self) -> Result<(), ProviderError> {
        let params = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "persistent-sage",
                "version": env!("CARGO_PKG_VERSION")
            }
        });
        let _ = self
            .request("initialize", Some(params), MCP_INIT_TIMEOUT_SECS)
            .await?;
        self.notify("notifications/initialized", None).await?;
        Ok(())
    }

    async fn list_tools(&mut self) -> Result<Vec<Value>, ProviderError> {
        let result = self
            .request("tools/list", Some(json!({})), MCP_INIT_TIMEOUT_SECS)
            .await?;
        let tools = result
            .get("tools")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(tools)
    }

    async fn call_tool(&mut self, name: &str, arguments: Value) -> Result<Value, ProviderError> {
        let params = json!({
            "name": name,
            "arguments": arguments
        });
        self.request("tools/call", Some(params), MCP_CALL_TIMEOUT_SECS)
            .await
    }

    async fn request(
        &mut self,
        method: &str,
        params: Option<Value>,
        timeout_secs: u64,
    ) -> Result<Value, ProviderError> {
        let id = MCP_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id,
            method: method.into(),
            params,
        };
        self.write_message(&req).await?;
        let resp = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            self.read_response(id),
        )
        .await
        .map_err(|_| tool_err(format!("MCP `{}` timeout on `{method}`", self.server_name)))?
        .map_err(|e| tool_err(format!("MCP `{}` read: {e}", self.server_name)))?;
        if let Some(err) = resp.error {
            return Err(tool_err(format!(
                "MCP `{}` RPC error ({}): {}",
                self.server_name, err.code, err.message
            )));
        }
        resp.result
            .ok_or_else(|| tool_err(format!("MCP `{}`: empty result for `{method}`", self.server_name)))
    }

    async fn notify(&mut self, method: &str, params: Option<Value>) -> Result<(), ProviderError> {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(json!({}))
        });
        self.write_raw(&msg).await
    }

    async fn write_message(&mut self, req: &JsonRpcRequest) -> Result<(), ProviderError> {
        self.write_raw(req).await
    }

    async fn write_raw<T: Serialize>(&mut self, value: &T) -> Result<(), ProviderError> {
        let body = serde_json::to_string(value)
            .map_err(|e| tool_err(format!("MCP `{}` encode: {e}", self.server_name)))?;
        let frame = format!("Content-Length: {}\r\n\r\n{body}", body.len());
        self.stdin
            .write_all(frame.as_bytes())
            .await
            .map_err(|e| tool_err(format!("MCP `{}` write: {e}", self.server_name)))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| tool_err(format!("MCP `{}` flush: {e}", self.server_name)))
    }

    async fn read_response(&mut self, expect_id: u64) -> Result<JsonRpcResponse, String> {
        loop {
            let msg = self.read_message().await?;
            if msg.get("method").is_some() && msg.get("id").is_none() {
                continue;
            }
            let id_matches = msg
                .get("id")
                .and_then(|v| v.as_u64())
                .map(|id| id == expect_id)
                .unwrap_or(false);
            if id_matches {
                return serde_json::from_value(msg).map_err(|e| e.to_string());
            }
        }
    }

    async fn read_message(&mut self) -> Result<Value, String> {
        let mut header = Vec::new();
        loop {
            let mut byte = [0u8; 1];
            self.reader
                .read_exact(&mut byte)
                .await
                .map_err(|e| e.to_string())?;
            header.push(byte[0]);
            if header.len() >= 4 && &header[header.len() - 4..] == b"\r\n\r\n" {
                break;
            }
            if header.len() > 8192 {
                return Err("MCP header too large".into());
            }
        }
        let header_str = String::from_utf8_lossy(&header);
        let mut content_length = None;
        for line in header_str.lines() {
            if let Some(rest) = line.strip_prefix("Content-Length:") {
                content_length = rest.trim().parse().ok();
            }
        }
        let len = content_length.ok_or_else(|| "missing Content-Length".to_string())?;
        let mut body = vec![0u8; len];
        self.reader
            .read_exact(&mut body)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&body).map_err(|e| e.to_string())
    }
}

pub fn mcp_tool_definitions_from_manager(manager: &McpPluginManager) -> Vec<ToolDefinition> {
    manager.tool_definitions()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_and_expose_tool_names() {
        assert_eq!(sanitize_segment("My Server!"), "my_server");
        assert_eq!(
            mcp_exposed_tool_name("filesystem", "read_file"),
            "mcp_filesystem_read_file"
        );
    }

    #[test]
    fn expand_placeholders() {
        let ws = PathBuf::from("/tmp/workspace");
        let data = PathBuf::from("/tmp/data");
        let plugin = PathBuf::from("/tmp/plugins/foo");
        let out = expand_placeholders(
            "${CLAUDE_PLUGIN_ROOT}/bin -- ${CLAUDE_PROJECT_DIR}",
            Some(&plugin),
            &plugin.join("data"),
            &ws,
            &data,
        );
        assert!(out.contains("/tmp/plugins/foo/bin"));
        assert!(out.contains("/tmp/workspace"));
    }
}
