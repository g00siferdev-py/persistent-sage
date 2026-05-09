//! Desktop binary entry point for Nova.
//!
//! Tauri command registration and `Builder` setup live in `nova_lib::run` so
//! the same initialization can be reused from the library crate (including
//! mobile builds). This binary only starts the desktop process.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nova_lib::run();
}
