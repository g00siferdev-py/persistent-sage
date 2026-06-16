//! Unrestricted coding mode for local experiments (e.g. Project Snowball self-improvement loop).
//!
//! Active when `PERSISTENT_SAGE_LAB_MODE=1` / `true`, or when the active coding repo id/name
//! contains `snowball` (case-insensitive).

use crate::coding::CodingTurnContext;

pub fn env_enabled() -> bool {
    match std::env::var("PERSISTENT_SAGE_LAB_MODE") {
        Ok(v) => {
            let t = v.trim();
            t == "1" || t.eq_ignore_ascii_case("true") || t.eq_ignore_ascii_case("yes")
        }
        Err(_) => false,
    }
}

pub fn is_snowball_repo(repo_id: &str, repo_name: &str) -> bool {
    let id = repo_id.to_ascii_lowercase();
    let name = repo_name.to_ascii_lowercase();
    id.contains("snowball") || name.contains("snowball")
}

pub fn unrestricted_coding(ctx: Option<&CodingTurnContext>) -> bool {
    if env_enabled() {
        return true;
    }
    ctx.is_some_and(|c| is_snowball_repo(&c.repo_id, &c.repo_name))
}

pub fn unrestricted_repo(repo_id: &str, repo_name: &str) -> bool {
    if env_enabled() {
        return true;
    }
    is_snowball_repo(repo_id, repo_name)
}

pub fn unrestricted_repo_path(path_rel: &str) -> bool {
    if env_enabled() {
        return true;
    }
    path_rel.to_ascii_lowercase().contains("snowball")
}

pub fn grep_max_matches(unrestricted: bool) -> usize {
    if unrestricted { 2000 } else { 80 }
}

pub fn grep_max_file_bytes(unrestricted: bool) -> u64 {
    if unrestricted { 8_000_000 } else { 512_000 }
}

pub fn patch_max_file_bytes(unrestricted: bool) -> u64 {
    if unrestricted { 8_000_000 } else { 900_000 }
}

pub fn ide_read_max_bytes(unrestricted: bool) -> u64 {
    if unrestricted { 8_000_000 } else { 512_000 }
}

pub fn ide_write_max_bytes(unrestricted: bool) -> usize {
    if unrestricted { 8_000_000 } else { 900_000 }
}

pub fn command_max_output_chars(unrestricted: bool) -> usize {
    if unrestricted { 512_000 } else { 96_000 }
}

pub fn command_timeout_max_secs(unrestricted: bool) -> u64 {
    if unrestricted { 7200 } else { 300 }
}

pub fn command_build_timeout_max_secs(unrestricted: bool) -> u64 {
    if unrestricted { 7200 } else { 1200 }
}

pub fn max_coding_tool_rounds(unrestricted: bool) -> u32 {
    if unrestricted { 128 } else { 32 }
}

pub fn tree_max_depth(unrestricted: bool) -> usize {
    if unrestricted { 12 } else { 4 }
}

pub fn tree_max_nodes(unrestricted: bool) -> usize {
    if unrestricted { 8000 } else { 400 }
}
