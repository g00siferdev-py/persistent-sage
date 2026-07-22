import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/** Catches render errors so the Tauri webview shows a message instead of a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[persistent-sage] UI render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-ps-canvas p-8 text-center text-ps-ink">
          <p className="text-sm font-semibold text-rose-300">Something went wrong in the UI</p>
          <p className="max-w-md text-xs text-ps-faint">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-md border border-ps-border bg-ps-elevated px-3 py-1.5 text-xs text-ps-ink hover:bg-ps-surface"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
