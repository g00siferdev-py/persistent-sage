import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Gauge } from "lucide-react";

export interface TokenContextInfo {
  tokensUsed: number;
  contextWindow: number;
  percentUsed: number;
  displayString: string;
  providerId: string;
  modelId: string;
}

interface TokenContextCounterProps {
  conversationId: string | null;
  refreshInterval?: number; // ms, default 5000
}

export function TokenContextCounter({
  conversationId,
  refreshInterval = 5000,
}: TokenContextCounterProps) {
  const [contextInfo, setContextInfo] = useState<TokenContextInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTokenContext = async () => {
    if (!conversationId) {
      setContextInfo(null);
      return;
    }

    try {
      const info = await invoke<TokenContextInfo>("memory_get_token_context", {
        conversationId,
      });
      setContextInfo(info);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    fetchTokenContext();

    const interval = setInterval(fetchTokenContext, refreshInterval);
    return () => clearInterval(interval);
  }, [conversationId, refreshInterval]);

  // Color based on usage
  const getColor = (percent: number) => {
    if (percent >= 90) return "text-red-500";
    if (percent >= 75) return "text-amber-500";
    return "text-emerald-500";
  };

  const getBgColor = (percent: number) => {
    if (percent >= 90) return "bg-red-500";
    if (percent >= 75) return "bg-amber-500";
    return "bg-emerald-500";
  };

  if (!conversationId) {
    return null;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 bg-red-950/50 rounded">
        <Gauge className="w-3.5 h-3.5" />
        <span>Context error</span>
      </div>
    );
  }

  if (!contextInfo) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <Gauge className="w-3.5 h-3.5 animate-pulse" />
        <span>Loading context...</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs bg-muted/50 rounded border"
      title={`${contextInfo.modelId} • ${contextInfo.providerId}`}
    >
      <Gauge className={`w-3.5 h-3.5 ${getColor(contextInfo.percentUsed)}`} />
      <div className="flex flex-col min-w-0">
        <span className="font-medium truncate">{contextInfo.displayString}</span>
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-0.5">
          <div
            className={`h-full ${getBgColor(contextInfo.percentUsed)} transition-all duration-300`}
            style={{ width: `${contextInfo.percentUsed}%` }}
          />
        </div>
      </div>
    </div>
  );
}
