export function normalizeRepoFilePath(filePath: string | null | undefined): string {
  let normalized = (filePath ?? "").trim().replace(/\\/g, "/");
  if (!normalized) return "";

  normalized = normalized.replace(/^file:\/\//i, "");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^workspace\/+/, "");
  normalized = normalized.replace(/^\.\/+/, "");
  normalized = normalized.replace(/\/{2,}/g, "/");

  return normalized;
}
