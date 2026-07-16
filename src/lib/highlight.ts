/**
 * Shared highlight.js core with a curated language set (keeps the bundle small
 * versus importing all ~190 grammars). Used by chat code blocks and the
 * Coding Playground editor overlay.
 */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

let registered = false;

function ensureRegistered() {
  if (registered) return;
  registered = true;
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("c", c);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("csharp", csharp);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("ini", ini);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("kotlin", kotlin);
  hljs.registerLanguage("lua", lua);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("php", php);
  hljs.registerLanguage("plaintext", plaintext);
  hljs.registerLanguage("powershell", powershell);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("ruby", ruby);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("swift", swift);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("yaml", yaml);
  hljs.configure({ ignoreUnescapedHTML: true });
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  node: "javascript",
  nodejs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  html: "xml",
  svg: "xml",
  md: "markdown",
  yml: "yaml",
  toml: "ini",
  text: "plaintext",
  txt: "plaintext",
};

export function resolveHighlightLanguage(raw?: string | null): string | null {
  ensureRegistered();
  const lang = (raw ?? "").trim().toLowerCase();
  if (!lang) return null;
  const resolved = LANGUAGE_ALIASES[lang] ?? lang;
  return hljs.getLanguage(resolved) ? resolved : null;
}

/** Returns highlight.js HTML (already escaped) for the given code. */
export function highlightCode(code: string, language?: string | null): string {
  ensureRegistered();
  const lang = resolveHighlightLanguage(language);
  try {
    if (lang) {
      return hljs.highlight(code, { language: lang }).value;
    }
    // Auto-detect only for short snippets — auto-detect on huge blobs is slow.
    if (code.length <= 20_000) {
      return hljs.highlightAuto(code).value;
    }
  } catch {
    // fall through to escaped plaintext
  }
  return hljs.highlight(code, { language: "plaintext" }).value;
}
