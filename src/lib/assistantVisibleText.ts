/**
 * Display text for an assistant reply that was not turned into an artifact.
 * Keep ```html / ```xml / ```artifact fences so MessageContent can render them.
 */
export function keepUnpromotedAssistantText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Display text once a fence has already been stored as `artifactJson`.
 * Drop only those promoted fences so the same HTML is not shown twice.
 */
export function stripPromotedArtifactFences(text: string): string {
  return text
    .replace(/```(?:artifact|html|htm|xml)\b[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
