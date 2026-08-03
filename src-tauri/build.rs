fn main() {
    // Forward optional Google OAuth client into the binary for one-click
    // "Sign in with Google". Official CI sets these via GitHub secrets.
    // Locally you may put them in src-tauri/.env (gitignored) or the process env.
    load_dotenv_google();
    for key in ["PS_GOOGLE_CLIENT_ID", "PS_GOOGLE_CLIENT_SECRET"] {
        if let Ok(v) = std::env::var(key) {
            let v = v.trim();
            if !v.is_empty() {
                println!("cargo:rustc-env={key}={v}");
            }
        }
    }
    println!("cargo:rerun-if-env-changed=PS_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=PS_GOOGLE_CLIENT_SECRET");
    println!("cargo:rerun-if-changed=.env");
    tauri_build::build()
}

fn load_dotenv_google() {
    let Ok(raw) = std::fs::read_to_string(".env") else {
        return;
    };
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let k = k.trim();
        if k != "PS_GOOGLE_CLIENT_ID" && k != "PS_GOOGLE_CLIENT_SECRET" {
            continue;
        }
        let v = v.trim().trim_matches('"').trim_matches('\'');
        if v.is_empty() {
            continue;
        }
        // Don't override an already-set process env (CI wins).
        if std::env::var_os(k).is_none() {
            // SAFETY: build script, single-threaded, before compile.
            std::env::set_var(k, v);
        }
    }
}
