import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, RotateCcw, Terminal, AlertTriangle, CheckCircle2 } from "lucide-react";

type PlaygroundLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "bash"
  | "powershell"
  | "rust";

const LANGUAGES: { id: PlaygroundLanguage; label: string; extension: string; defaultCode: string }[] = [
  {
    id: "python",
    label: "Python",
    extension: "py",
    defaultCode: 'print("Hello from Persistent Sage playground!")',
  },
  {
    id: "javascript",
    label: "Node.js (JS)",
    extension: "js",
    defaultCode: 'console.log("Hello from Persistent Sage playground!");',
  },
  {
    id: "typescript",
    label: "TypeScript",
    extension: "ts",
    defaultCode: 'console.log("Hello from Persistent Sage playground!");',
  },
  {
    id: "bash",
    label: "Bash",
    extension: "sh",
    defaultCode: 'echo "Hello from Persistent Sage playground!"',
  },
  {
    id: "powershell",
    label: "PowerShell",
    extension: "ps1",
    defaultCode: 'Write-Output "Hello from Persistent Sage playground!"',
  },
  {
    id: "rust",
    label: "Rust",
    extension: "rs",
    defaultCode: 'fn main() {\n    println!("Hello from Persistent Sage playground!");\n}',
  },
];

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  elapsedSecs: number;
  tempFilePath?: string | null;
  error?: string | null;
  networkAllowed: boolean;
  sandboxApplied: boolean;
  telemetryLogPath?: string | null;
};

export function CodingPlaygroundPanel() {
  const [language, setLanguage] = useState<PlaygroundLanguage>("python");
  const [code, setCode] = useState(LANGUAGES[0].defaultCode);
  const [args, setArgs] = useState("");
  const [stdin, setStdin] = useState("");
  const [timeout, setTimeout] = useState(30);
  const [allowNetwork, setAllowNetwork] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const currentLang = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0];

  const handleLanguageChange = (id: PlaygroundLanguage) => {
    setLanguage(id);
    const lang = LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0];
    setCode(lang.defaultCode);
    setResult(null);
  };

  const run = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await invoke<RunResult>("coding_playground_run", {
        request: {
          language,
          code,
          args: args
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
          stdin,
          timeoutSecs: Math.max(1, Math.min(300, timeout)),
          allowNetwork,
        },
      });
      setResult(res);
    } catch (e) {
      setResult({
        stdout: "",
        stderr: "",
        exitCode: null,
        elapsedSecs: 0,
        tempFilePath: null,
        error: e instanceof Error ? e.message : String(e),
        networkAllowed: allowNetwork,
        sandboxApplied: false,
        telemetryLogPath: null,
      });
    } finally {
      setLoading(false);
    }
  }, [language, code, args, stdin, timeout, allowNetwork]);

  const clear = useCallback(() => {
    setResult(null);
    setCode(currentLang.defaultCode);
  }, [currentLang]);

  const lineCount = Math.max(1, code.split("\n").length);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950/40">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as PlaygroundLanguage)}
            disabled={loading}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowOptions((v) => !v)}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            {showOptions ? "Hide options" : "Options"}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || !code.trim()}
            className="flex items-center gap-1 rounded bg-violet-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            {loading ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={loading}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Collapsible options */}
      {showOptions && (
        <div className="flex shrink-0 gap-3 border-b border-slate-800 bg-slate-900/60 px-3 py-2">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Arguments (one per line)
            </label>
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className="h-16 resize-none rounded border border-slate-700 bg-slate-950 p-1.5 font-mono text-[11px] text-slate-200 outline-none focus:border-violet-500"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Stdin
            </label>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              className="h-16 resize-none rounded border border-slate-700 bg-slate-950 p-1.5 font-mono text-[11px] text-slate-200 outline-none focus:border-violet-500"
              spellCheck={false}
            />
          </div>
          <div className="flex w-28 flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Timeout (s)
            </label>
            <input
              type="number"
              min={1}
              max={300}
              value={timeout}
              onChange={(e) => setTimeout(Number(e.target.value))}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500"
            />
          </div>
          <div className="flex w-40 flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Network
            </label>
            <select
              value={allowNetwork ? "allow" : "block"}
              onChange={(e) => setAllowNetwork(e.target.value === "allow")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500"
            >
              <option value="block">Blocked (sandbox)</option>
              <option value="allow">Allowed</option>
            </select>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="shrink-0 select-none overflow-hidden border-r border-slate-800 bg-slate-900/50 py-2 pr-2 text-right font-mono text-[11px] leading-[1.45rem] text-slate-600"
          aria-hidden
        >
          {lineNumbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          placeholder={`Write ${currentLang.label} code here…`}
          className="min-h-0 w-full flex-1 resize-none bg-transparent py-2 pl-2 font-mono text-[12px] leading-[1.45rem] text-slate-100 outline-none"
        />
      </div>

      {/* Output */}
      <div className="flex min-h-[8rem] shrink-0 flex-col border-t border-slate-800 bg-slate-950/60">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-1">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Output
            </span>
          </div>
          {result && (
            <div className="flex items-center gap-2 text-[11px]">
              {result.error ? (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {result.error}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  exit {result.exitCode ?? "?"} · {result.elapsedSecs.toFixed(2)}s · {result.sandboxApplied ? "sandboxed" : result.networkAllowed ? "network allowed" : "no sandbox"}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {result ? (
            <div className="space-y-2">
              {result.stdout && (
                <pre className="whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] text-slate-200">
                  {result.stdout}
                </pre>
              )}
              {result.stderr && (
                <pre className="whitespace-pre-wrap rounded border border-red-900/50 bg-red-950/20 p-2 font-mono text-[11px] text-red-200">
                  {result.stderr}
                </pre>
              )}
              {!result.stdout && !result.stderr && !result.error && (
                <p className="text-xs italic text-slate-500">No output.</p>
              )}
            </div>
          ) : (
            <p className="text-xs italic text-slate-500">
              Click Run to execute the snippet in a sandboxed temp directory outside your repo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
