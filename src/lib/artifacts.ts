/** Chat artifact types (mirrors Rust `ChatArtifact`). */

export type ArtifactCitation = {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  label?: string;
};

export type ChatArtifact = {
  type: "html" | "vegaLite" | "markdown" | "form" | string;
  title: string;
  body: string | Record<string, unknown>;
  caption?: string;
  citations?: ArtifactCitation[];
  projectId?: string;
};

export function parseArtifactJson(json: string | undefined | null): ChatArtifact | null {
  if (!json?.trim()) return null;
  try {
    const raw = JSON.parse(json) as ChatArtifact & { artifactType?: string };
    const type = (raw.type ?? raw.artifactType ?? "").toString();
    if (!type || !raw.title) return null;
    const projectId =
      typeof raw.projectId === "string" && raw.projectId.trim()
        ? raw.projectId.trim()
        : undefined;
    return { ...raw, type, projectId };
  } catch {
    return null;
  }
}

export function artifactBodyString(body: ChatArtifact["body"]): string {
  if (typeof body === "string") return body;
  return JSON.stringify(body, null, 2);
}
