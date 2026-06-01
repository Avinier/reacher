export function formatDateTime(value: unknown, options: Intl.DateTimeFormatOptions = {}) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    ...options
  }).format(new Date(timestamp));
}

export function formatDuration(start: unknown, end: unknown) {
  const startedAt = Number(start);
  const endedAt = Number(end);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return "Pending";
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function humanizeToken(value: unknown) {
  return String(value ?? "").replaceAll("_", " ");
}
